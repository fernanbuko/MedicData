// Este script lo ejecuta GitHub Actions cada cierto tiempo (ver el archivo
// .github/workflows/revisar-citas.yml). Revisa las próximas citas de cada
// consultorio y manda una notificación push al celular del médico/a (o de
// todo el equipo, si tiene colaboradores) cuando falta poco para una cita,
// o cuando una cita ya pasó y nadie la marcó como "atendida".
//
// No modifica nada más de la app: solo LEE los registros de citas y config,
// y ESCRIBE una marca en cada cita para no avisar dos veces por lo mismo.
//
// A propósito, este script NO usa consultas de "grupo de colección"
// (collectionGroup): esas requieren crear un índice especial en Firestore
// que puede ser confuso de configurar a mano. En su lugar, revisa
// consultorio por consultorio — más lento con MUCHOS usuarios, pero no
// necesita ninguna configuración extra en Firestore.

const admin = require("firebase-admin");

// La llave de servicio viene de un "secreto" de GitHub (nunca se sube al
// repositorio en texto plano). Ver el README para configurarlo.
const crudo = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
let serviceAccount;
try {
  serviceAccount = JSON.parse(crudo);
} catch (e) {
  console.error("❌ El secreto FIREBASE_SERVICE_ACCOUNT_JSON no se pudo leer como JSON válido.");
  console.error("Longitud recibida (caracteres):", crudo.length);
  console.error("Mensaje del error de parseo:", e.message);
  process.exit(1);
}
if (!serviceAccount.private_key || !serviceAccount.client_email || !serviceAccount.project_id) {
  console.error("❌ El JSON se leyó, pero le faltan campos esperados (private_key, client_email o project_id).");
  process.exit(1);
}
console.log("✅ Llave de servicio leída correctamente para el proyecto:", serviceAccount.project_id);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const messaging = admin.messaging();

// Zona horaria del consultorio, como desfase respecto a UTC en horas.
// Ecuador = -5. Cámbialo si tu consultorio está en otro país.
const DESFASE_HORAS = -5;

// Ventana de aviso: se notifica cuando falten entre 0 y 30 minutos para
// una cita.
const MINUTOS_VENTANA = 30;

function ahoraEnConsultorio() {
  return new Date(Date.now() + DESFASE_HORAS * 60 * 60 * 1000);
}
function comoTexto(fecha) {
  const y = fecha.getUTCFullYear();
  const m = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const d = String(fecha.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function hoyComoTexto() {
  return comoTexto(ahoraEnConsultorio());
}
function ayerComoTexto() {
  return comoTexto(new Date(ahoraEnConsultorio().getTime() - 24 * 60 * 60 * 1000));
}

function minutosHastaLaCita(fechaTexto, horaTexto) {
  const [anio, mes, dia] = fechaTexto.split("-").map(Number);
  const [hora, minuto] = horaTexto.split(":").map(Number);
  const momentoCitaUTC = Date.UTC(anio, mes - 1, dia, hora - DESFASE_HORAS, minuto, 0);
  return Math.round((momentoCitaUTC - Date.now()) / 60000);
}

async function enviarNotificacion(tokens, titulo, cuerpo, url) {
  const tokensValidos = (tokens || []).filter(Boolean);
  if (tokensValidos.length === 0) return;
  try {
    await messaging.sendEachForMulticast({
      tokens: tokensValidos,
      notification: { title: titulo, body: cuerpo },
      data: { url: url || "./index.html" },
    });
    console.log(`   📨 Notificación enviada a ${tokensValidos.length} dispositivo(s): "${titulo}"`);
  } catch (e) {
    console.error("   ❌ Error enviando notificación:", e.message);
  }
}

async function revisarConsultorio(ownerUid) {
  const configDoc = await db.collection("users").doc(ownerUid).collection("data").doc("config").get();
  const config = configDoc.exists ? configDoc.data() : {};
  const tokensPropios = config.fcmTokens || [];

  // Junta los tokens de los colaboradores del consultorio, para avisarles
  // también a ellos (ej. la secretaria) de las citas próximas.
  const colaboradoresSnap = await db.collection("users").doc(ownerUid).collection("colaboradores").get();
  let tokens = [...tokensPropios];
  // (Los colaboradores no tienen tokens propios en este esquema simple:
  // las notificaciones llegan a los dispositivos donde inició sesión la
  // cuenta dueña del consultorio. Si quieres notificar también a cada
  // colaborador por separado, guarda sus tokens en su propio documento de
  // usuario y agrégalos aquí.)

  if (tokens.length === 0) return;

  const hoy = hoyComoTexto();
  const ayer = ayerComoTexto();

  const citasSnap = await db
    .collection("users")
    .doc(ownerUid)
    .collection("citas")
    .where("fecha", "in", [ayer, hoy])
    .get();

  for (const doc of citasSnap.docs) {
    const cita = doc.data();
    if (cita.estado === "cancelada" || cita.estado === "atendida") continue;

    if (cita.fecha === ayer) {
      // Se pasó la fecha y nadie la marcó como atendida: un solo aviso.
      if (!cita.avisoVencidaEnviado) {
        await enviarNotificacion(
          tokens,
          "Cita sin marcar",
          `La cita de ${cita.patientName} de ayer no se marcó como atendida.`
        );
        await doc.ref.set({ avisoVencidaEnviado: true }, { merge: true });
      }
      continue;
    }

    // cita.fecha === hoy
    const faltan = minutosHastaLaCita(cita.fecha, cita.hora);
    if (faltan >= 0 && faltan <= MINUTOS_VENTANA && !cita.recordatorioEnviado) {
      await enviarNotificacion(
        tokens,
        "Cita próxima",
        `${cita.patientName} tiene cita hoy a las ${cita.hora} (en ${faltan} min).`
      );
      await doc.ref.set({ recordatorioEnviado: true }, { merge: true });
    }
  }
}

async function main() {
  console.log("🔎 Buscando consultorios con notificaciones activadas…");
  const usersSnap = await db.collection("users").get();
  console.log(`   ${usersSnap.size} cuenta(s) encontrada(s).`);
  for (const userDoc of usersSnap.docs) {
    try {
      // Solo cuentas "dueñas" tienen documento de config con fcmTokens; los
      // colaboradores no llevan citas propias, así que basta con revisar
      // cada uid como si fuera un posible dueño.
      await revisarConsultorio(userDoc.id);
    } catch (e) {
      console.error(`   ❌ Error revisando ${userDoc.id}:`, e.message);
    }
  }
  console.log("✅ Revisión terminada.");
}

main().catch((e) => {
  console.error("❌ Error inesperado:", e);
  process.exit(1);
});
