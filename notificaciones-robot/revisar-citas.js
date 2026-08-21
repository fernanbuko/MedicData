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

// Dos cosas separadas, siempre ambas: (1) un documento en
// users/{ownerUid}/notificaciones para que la campanita dentro de la app
// lo muestre — esto pasa SIEMPRE, tenga o no tenga el consultorio
// notificaciones push activadas; (2) un push de verdad, solo si hay al
// menos un token registrado.
async function enviarNotificacion(ownerUid, tokens, titulo, cuerpo, url) {
  try {
    await db.collection("users").doc(ownerUid).collection("notificaciones").add({
      titulo,
      cuerpo,
      leida: false,
      url: url || "./index.html",
      creadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error("   ❌ Error guardando notificación en la app:", e.message);
  }

  const tokensValidos = (tokens || []).filter(Boolean);
  if (tokensValidos.length === 0) return;
  try {
    await messaging.sendEachForMulticast({
      tokens: tokensValidos,
      notification: { title: titulo, body: cuerpo },
      data: { url: url || "./index.html" },
    });
    console.log(`   📨 Push enviado a ${tokensValidos.length} dispositivo(s): "${titulo}"`);
  } catch (e) {
    console.error("   ❌ Error enviando push:", e.message);
  }
}

async function revisarConsultorio(ownerUid) {
  const configDoc = await db.collection("users").doc(ownerUid).collection("data").doc("config").get();
  const config = configDoc.exists ? configDoc.data() : {};
  // (Los colaboradores no tienen tokens propios en este esquema simple:
  // el push llega a los dispositivos donde inició sesión la cuenta dueña
  // del consultorio. Si quieres notificar también a cada colaborador por
  // separado, guarda sus tokens en su propio documento de usuario y
  // súmalos aquí. La notificación EN LA APP sí queda disponible para
  // todo el equipo, porque vive en los datos compartidos del consultorio.)
  const tokens = config.fcmTokens || [];

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
          ownerUid,
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
        ownerUid,
        tokens,
        "Cita próxima",
        `${cita.patientName} tiene cita hoy a las ${cita.hora} (en ${faltan} min).`
      );
      await doc.ref.set({ recordatorioEnviado: true }, { merge: true });
    }
  }
}

async function main() {
  console.log("🔎 Buscando consultorios registrados…");
  // OJO: nunca escribimos nada directo en "users/{uid}" (solo en sus
  // subcolecciones, como "pacientes" o "citas"), así que ese documento
  // nunca "existe" para Firestore y db.collection("users").get() siempre
  // devuelve vacío. La lista real de consultorios está en
  // "cuentasRegistradas" (la misma que usa el panel de administración de
  // la app), así que la usamos como fuente de verdad aquí también.
  const cuentasSnap = await db.collection("cuentasRegistradas").get();
  console.log(`   ${cuentasSnap.size} cuenta(s) encontrada(s).`);
  for (const cuentaDoc of cuentasSnap.docs) {
    if (cuentaDoc.data().bloqueada) {
      console.log(`   ⏭ ${cuentaDoc.id} está bloqueada, se salta.`);
      continue;
    }
    try {
      await revisarConsultorio(cuentaDoc.id);
    } catch (e) {
      console.error(`   ❌ Error revisando ${cuentaDoc.id}:`, e.message);
    }
  }
  console.log("✅ Revisión terminada.");
}

main().catch((e) => {
  console.error("❌ Error inesperado:", e);
  process.exit(1);
});
