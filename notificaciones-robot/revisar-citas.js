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

// Para borrar de verdad un archivo de Cloudinary hace falta la clave
// secreta de la cuenta — nunca debe estar en el código del navegador, así
// que vive solo aquí, como secreto de GitHub (ver README). El nombre de
// cuenta (CLOUDINARY_CLOUD_NAME) no es secreto, es el mismo que ya está
// público en index.html.
const CLOUDINARY_CLOUD_NAME = "zcuh5bjn";
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";
const cloudinaryBorrarListo = !!(CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
if (!cloudinaryBorrarListo) {
  console.log("ℹ️ CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET no están configurados: las fotos borradas en la app se van a quedar pendientes de borrar en Cloudinary hasta que se agreguen (ver README).");
}

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

// Copia logo/foto/nombre desde la config del consultorio hacia su fila en
// cuentasRegistradas, para que el panel de administración los pueda
// mostrar (ese panel solo tiene permiso de leer cuentasRegistradas, no la
// config de cada consultorio). El robot corre con permisos de
// administrador, así que puede leer la config de CUALQUIER consultorio —
// por eso este "backfill" pasa solo, sin que cada médico/a tenga que
// entrar a Configuración y guardar de nuevo.
async function sincronizarResumenCuenta(ownerUid, config, cuentaActual) {
  const campos = {};
  for (const campo of ["logoUrl", "fotoMedico", "nombreConsultorio", "nombreMedico"]) {
    if (config[campo] && config[campo] !== cuentaActual[campo]) campos[campo] = config[campo];
  }
  if (Object.keys(campos).length === 0) return;
  try {
    await db.collection("cuentasRegistradas").doc(ownerUid).set(campos, { merge: true });
    console.log(`   🖼 Resumen actualizado (${Object.keys(campos).join(", ")}).`);
  } catch (e) {
    console.error("   ❌ Error actualizando el resumen de la cuenta:", e.message);
  }
}

// Saca el "public_id" y el tipo de recurso (image/video/raw) de una URL
// como https://res.cloudinary.com/<cuenta>/image/upload/v169.../carpeta/archivo.jpg
// — son los datos que pide la API de Cloudinary para borrar un archivo.
function datosCloudinaryDesdeUrl(url) {
  const m = String(url || "").match(/res\.cloudinary\.com\/[^/]+\/(image|video|raw)\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:\?.*)?$/);
  if (!m) return null;
  return { resourceType: m[1], publicId: decodeURIComponent(m[2]) };
}

function encabezadoCloudinary() {
  return { Authorization: `Basic ${Buffer.from(`${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`).toString("base64")}` };
}

async function borrarDeCloudinary(publicIds, resourceType) {
  const params = new URLSearchParams();
  publicIds.forEach((id) => params.append("public_ids[]", id));
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/${resourceType}/upload?${params}`,
    { method: "DELETE", headers: encabezadoCloudinary() }
  );
  if (!res.ok) throw new Error(`Cloudinary respondió ${res.status}`);
  return res.json();
}

// Borra TODO lo que haya adentro de una carpeta (logo, foto de perfil,
// fotos, exámenes…), sin importar qué tipos de archivo tenga — se usa al
// eliminar un paciente. Intenta los tres tipos de recurso de Cloudinary
// porque una carpeta de paciente puede tener fotos (image) y PDFs de
// exámenes (raw); el que no tenga nada simplemente no borra nada, sin
// error. Al final intenta borrar también el objeto "carpeta" vacío — es
// solo cosmético (no ocupa espacio), así que si falla no importa.
async function borrarCarpetaDeCloudinary(carpeta) {
  for (const resourceType of ["image", "raw", "video"]) {
    const params = new URLSearchParams({ prefix: carpeta });
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/${resourceType}/upload?${params}`,
      { method: "DELETE", headers: encabezadoCloudinary() }
    );
    if (!res.ok) throw new Error(`Cloudinary respondió ${res.status} borrando ${resourceType} de "${carpeta}"`);
  }
  for (const sub of [`${carpeta}/fotos`, `${carpeta}/examenes`, carpeta]) {
    await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/folders/${encodeURIComponent(sub)}`, {
      method: "DELETE",
      headers: encabezadoCloudinary(),
    }).catch(() => {});
  }
}

// Revisa las fotos que se borraron desde la app (ver marcarCloudinaryParaBorrar
// en index.html) y las borra de verdad de Cloudinary, para no acumular
// archivos huérfanos ocupando espacio. Si no hay clave de Cloudinary
// configurada todavía, las deja pendientes — no se pierden, solo esperan.
async function procesarPendientesDeCloudinary(ownerUid) {
  if (!cloudinaryBorrarListo) return;
  const snap = await db.collection("users").doc(ownerUid).collection("cloudinaryPendientes").get();
  if (snap.empty) return;

  const porTipo = {}; // { image: [{docRef, publicId}], ... } — archivos sueltos
  const carpetas = []; // { ref, carpeta } — carpetas completas (paciente eliminado)
  for (const doc of snap.docs) {
    const { url, carpeta } = doc.data();
    if (carpeta) {
      carpetas.push({ ref: doc.ref, carpeta });
      continue;
    }
    const datos = datosCloudinaryDesdeUrl(url);
    if (!datos) {
      // URL rara/no reconocida: no se puede borrar sola, se descarta la
      // solicitud para no quedar reintentando para siempre.
      await doc.ref.delete().catch(() => {});
      continue;
    }
    if (!porTipo[datos.resourceType]) porTipo[datos.resourceType] = [];
    porTipo[datos.resourceType].push({ ref: doc.ref, publicId: datos.publicId });
  }

  for (const [resourceType, items] of Object.entries(porTipo)) {
    try {
      await borrarDeCloudinary(items.map((it) => it.publicId), resourceType);
      await Promise.all(items.map((it) => it.ref.delete()));
      console.log(`   🗑 ${items.length} archivo(s) borrados de Cloudinary (${resourceType}).`);
    } catch (e) {
      console.error(`   ❌ Error borrando de Cloudinary (${resourceType}):`, e.message);
    }
  }

  for (const { ref, carpeta } of carpetas) {
    try {
      await borrarCarpetaDeCloudinary(carpeta);
      await ref.delete();
      console.log(`   🗑 Carpeta borrada de Cloudinary: ${carpeta}`);
    } catch (e) {
      console.error(`   ❌ Error borrando la carpeta "${carpeta}" de Cloudinary:`, e.message);
    }
  }
}

async function revisarConsultorio(ownerUid, cuentaActual) {
  const configDoc = await db.collection("users").doc(ownerUid).collection("data").doc("config").get();
  const config = configDoc.exists ? configDoc.data() : {};
  await sincronizarResumenCuenta(ownerUid, config, cuentaActual);
  await procesarPendientesDeCloudinary(ownerUid);
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

// "Eliminar cuenta" en Configuración (ver ConfigView) solo marca la
// cuenta con eliminada:true — borrar de verdad todos sus pacientes,
// consultas, recetas, exámenes, citas y fotos, más sus archivos de
// Cloudinary, lo hace el robot aquí, con permisos de administrador. Es
// mucho más seguro que intentar borrar todo eso desde el navegador
// (podría cortarse la conexión a la mitad y dejar la cuenta a medio
// borrar). recursiveDelete se encarga de TODAS las subcolecciones de
// una sola vez, sin tener que enumerarlas a mano.
async function procesarCuentaEliminada(ownerUid) {
  console.log(`   🗑 Cuenta ${ownerUid} marcada para eliminar — borrando todo…`);
  if (cloudinaryBorrarListo) {
    try {
      await procesarPendientesDeCloudinary(ownerUid);
    } catch (e) {
      console.error("   ❌ Error borrando archivos de Cloudinary de la cuenta eliminada:", e.message);
    }
  }
  await db.recursiveDelete(db.collection("users").doc(ownerUid));
  await db.collection("cuentasRegistradas").doc(ownerUid).delete();
  console.log(`   ✅ Cuenta ${ownerUid} eliminada por completo.`);
}

// Deja constancia de cuándo corrió el robot por última vez, para que el
// panel de administración lo muestre (ver PanelAdminView) — así se nota
// si el cron externo dejó de llamar al workflow.
async function marcarCorridaDelRobot(cuentasRevisadas) {
  try {
    await db.collection("sistemaRobot").doc("estado").set(
      {
        ultimaCorrida: admin.firestore.FieldValue.serverTimestamp(),
        cuentasRevisadas,
      },
      { merge: true }
    );
  } catch (e) {
    console.error("❌ Error guardando el estado del robot:", e.message);
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
    if (cuentaDoc.data().eliminada) {
      try {
        await procesarCuentaEliminada(cuentaDoc.id);
      } catch (e) {
        console.error(`   ❌ Error eliminando la cuenta ${cuentaDoc.id}:`, e.message);
      }
      continue;
    }
    if (cuentaDoc.data().bloqueada) {
      console.log(`   ⏭ ${cuentaDoc.id} está bloqueada, se salta.`);
      continue;
    }
    try {
      await revisarConsultorio(cuentaDoc.id, cuentaDoc.data());
    } catch (e) {
      console.error(`   ❌ Error revisando ${cuentaDoc.id}:`, e.message);
    }
  }
  await marcarCorridaDelRobot(cuentasSnap.size);
  console.log("✅ Revisión terminada.");
}

main().catch((e) => {
  console.error("❌ Error inesperado:", e);
  process.exit(1);
});
