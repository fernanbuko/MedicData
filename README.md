# MedicData

Historia clínica, recetas, exámenes y agenda de pacientes — una app para
consultorios médicos, inspirada en [VetData](https://github.com/fernanbuko/appvet)
pero para personas.

Es una **app web progresiva (PWA)**: un solo archivo `index.html`, sin paso
de build (React y Babel se cargan desde un CDN), que se instala en el
celular como una app normal y funciona sin internet una vez cargada. Los
datos se guardan en Firebase (gratis para un consultorio pequeño) y las
fotos/archivos en Cloudinary.

## Qué incluye

- **Pacientes**: ficha con datos personales, contacto de emergencia, seguro
  médico, alergias y antecedentes.
- **Historia clínica**: una entrada por cada consulta, con signos vitales
  (presión, frecuencia cardíaca/respiratoria, temperatura, saturación,
  peso/talla/IMC), motivo, examen físico, diagnóstico, plan e indicaciones.
- **Recetas**: uno o más medicamentos por receta (dosis, vía, frecuencia,
  duración), para imprimir o compartir por WhatsApp/correo.
- **Exámenes**: laboratorio o imágenes, con resultado en texto y archivo
  adjunto (PDF o foto).
- **Agenda**: calendario mensual de citas, con recordatorio automático por
  notificación push antes de cada una.
- **Equipo**: el/la dueño/a del consultorio puede invitar colaboradores
  (secretaria, enfermera, médico/a asociado/a) con un código, y elegir qué
  secciones puede ver cada quien.
- **Panel de administración**: solo visible para el correo fijado como
  `ADMIN_EMAIL` en el código — lista todos los consultorios registrados
  (no sus datos clínicos) y permite bloquear/desbloquear el acceso de una
  cuenta. Pensado para cuando MedicData se ofrece a más de un consultorio,
  no para el uso normal del día a día.
- **Modo oscuro** y **PWA instalable**.

## 1. Crear tu proyecto de Firebase

1. Ve a [console.firebase.google.com](https://console.firebase.google.com) y
   crea un proyecto nuevo (gratis).
2. **Authentication** → pestaña "Sign-in method" → habilita **Correo
   electrónico/contraseña**.
3. **Firestore Database** → crea una base de datos (modo producción está
   bien, ya trae sus propias reglas).
4. En **Configuración del proyecto → General → Tus apps**, agrega una app
   **Web** (ícono `</>`). Copia el objeto `firebaseConfig` que te muestra.
5. Abre `index.html` en este proyecto, busca `const firebaseConfig = {`
   (cerca del inicio del bloque de JavaScript) y reemplázalo con el que
   copiaste.
6. **Firestore Database → Reglas**: pega el contenido de `firestore.rules`
   (incluido en este proyecto) y publica.

### Notificaciones push (opcional, pero recomendado)

1. **Configuración del proyecto → Cloud Messaging → Configuración web →
   Generar par de claves**. Copia la clave.
2. En `index.html`, busca `const VAPID_KEY = "PENDIENTE_DE_CONFIGURAR";` y
   pega tu clave ahí.
3. Cada persona activa las notificaciones desde **Configuración → Activar
   notificaciones** dentro de la app.

## 2. Crear tu cuenta de Cloudinary (para fotos y archivos)

1. Crea una cuenta gratis en [cloudinary.com](https://cloudinary.com).
2. En el Dashboard, copia tu **Cloud name**.
3. Ve a **Settings → Upload → Upload presets → Add upload preset**, y
   ponlo en modo **Unsigned**. Copia el nombre del preset.
4. En `index.html`, busca `CLOUDINARY_CLOUD_NAME` y
   `CLOUDINARY_UPLOAD_PRESET`, y reemplaza los valores de ejemplo.

Los archivos se suben organizados en carpetas, no todos sueltos en la raíz:
`medicdata/{tu cuenta}/logo`, `.../perfil`, y `.../pacientes/{id}_{nombre}/`
(con una subcarpeta `examenes` para los archivos adjuntos de cada paciente).
Puedes navegar así por la Media Library de Cloudinary sin perderte.

Si no configuras Cloudinary, la app funciona igual, solo que no podrás
subir fotos de pacientes ni archivos adjuntos de exámenes.

## 3. Publicar la app (GitHub Pages)

1. Crea un repositorio en GitHub y sube todos los archivos de esta carpeta.
2. En **Settings → Pages**, elige la rama `main` y la carpeta raíz (`/`).
3. En unos minutos tu app queda disponible en
   `https://TU_USUARIO.github.io/TU_REPOSITORIO/`.
4. Ábrela desde el celular y usa "Agregar a pantalla de inicio" (o el botón
   de instalar del navegador) para tenerla como una app normal.

Cualquier otro hosting de archivos estáticos (Netlify, Vercel, Firebase
Hosting, etc.) también funciona — no hace falta nada especial, es HTML
plano.

## 4. Robot de recordatorios (notificaciones push automáticas)

La carpeta `notificaciones-robot/` contiene un script que revisa las citas
próximas y manda una notificación push cuando falta poco. Se ejecuta con
GitHub Actions — no necesitas un servidor propio.

1. En Firebase Console → **Configuración del proyecto → Cuentas de
   servicio → Generar nueva clave privada**. Se descarga un archivo JSON.
2. En tu repositorio de GitHub: **Settings → Secrets and variables →
   Actions → New repository secret**.
   - Nombre: `FIREBASE_SERVICE_ACCOUNT_JSON`
   - Valor: pega el contenido completo del archivo JSON descargado.
3. Listo — el flujo `.github/workflows/revisar-citas.yml` ya está incluido.
   Puedes probarlo a mano desde la pestaña **Actions** de tu repositorio →
   "Revisar citas próximas y enviar notificaciones" → **Run workflow**.

Por defecto asume que el consultorio está en la zona horaria de Ecuador
(UTC-5). Si estás en otro país, cambia `DESFASE_HORAS` al inicio de
`notificaciones-robot/revisar-citas.js`.

### Borrar de verdad las fotos eliminadas en Cloudinary (opcional)

Cuando alguien elimina una foto en la app, esta se borra de Firestore al
instante, pero el archivo en Cloudinary no se puede borrar directo desde
el navegador — hace falta la clave secreta de la cuenta, y esa clave
nunca debe estar en el código del sitio (cualquiera podría verla y borrar
o cambiar cualquier archivo de tu cuenta). El robot de recordatorios ya
corre de forma segura en GitHub Actions, así que es quien se encarga de
borrar de verdad en su próxima corrida:

1. En [cloudinary.com](https://cloudinary.com) → **Dashboard**, en la
   sección "Account details" copia el **API Key**, y toca el ícono del
   ojo para revelar el **API Secret** y cópialo también.
2. En tu repositorio de GitHub: **Settings → Secrets and variables →
   Actions → New repository secret**, y agrega dos secretos:
   - Nombre: `CLOUDINARY_API_KEY` — valor: el API Key que copiaste.
   - Nombre: `CLOUDINARY_API_SECRET` — valor: el API Secret que copiaste.
   - ⚠️ **No me pegues estas claves a mí ni las pongas en el código del
     repositorio** — van solo en los secretos de GitHub.
3. Listo — sin hacer nada más, en la próxima corrida del robot (cada ~30
   minutos, o a mano desde **Actions → Run workflow**) se borran de
   Cloudinary las fotos que ya se hayan eliminado en la app.

Si no configuras esto, la app sigue funcionando igual — las fotos
eliminadas simplemente se quedan ocupando espacio en Cloudinary hasta que
agregues las claves.

### Que corra puntual de verdad, con cron-job.org

El disparador `schedule` de GitHub Actions es "mejor esfuerzo": en repos
nuevos o con poca actividad puede atrasarse horas, o saltarse corridas por
completo — no es algo que se pueda ajustar desde la configuración. La
forma confiable es un **cron externo** que llame a la API de GitHub para
disparar el flujo cada cierto tiempo. El workflow ya está listo para
recibir esto (evento `repository_dispatch`); solo falta el cron externo:

1. **Crea un token de GitHub** para autorizar la llamada:
   - Ve a [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
     → **Generate new token** (fine-grained).
   - **Repository access** → **Only select repositories** → elige
     `MedicData`.
   - En **Permissions → Repository permissions**, busca **Actions** y
     ponlo en **Read and write**.
   - Genera el token y **cópialo una sola vez** (no lo vuelves a ver).
   - ⚠️ **No me pegues este token a mí ni lo pongas en el código del
     repositorio** — es una credencial con acceso a tu cuenta de GitHub.
     Se configura directo en cron-job.org, en el paso siguiente.

2. **Crea una cuenta gratis en [cron-job.org](https://cron-job.org)** →
   **Create cronjob**:
   - **URL**: `https://api.github.com/repos/fernanbuko/MedicData/dispatches`
   - **Método**: `POST`
   - **Encabezados (Headers)**:
     - `Authorization: Bearer TU_TOKEN_AQUÍ`
     - `Accept: application/vnd.github+json`
     - `Content-Type: application/json`
   - **Cuerpo (Body)**: `{"event_type": "revisar-citas"}`
   - **Horario**: cada 30 minutos.
   - Guarda.

3. Pruébalo con el botón **"Run now"** de cron-job.org, y confirma en la
   pestaña **Actions** de tu repo que aparezca una corrida nueva con
   evento `repository_dispatch` (no `schedule`).

Con esto el robot corre puntual sin depender del scheduler de GitHub. El
`schedule` de cada 30 minutos se deja como respaldo — no estorba, solo es
menos puntual.

## 5. Primer uso

1. Abre la app → **Crear consultorio** → completa tus datos.
2. Empieza a registrar pacientes desde la pestaña **Pacientes**.
3. Agenda citas desde **Agenda**; al tocar "Atender" en una cita se abre
   directamente el formulario de nueva consulta para ese paciente.
4. Para sumar a tu secretaria o enfermera: **Configuración → Invitar a mi
   equipo**, comparte el código, y desde su celular eligen "Unirme a un
   equipo" en la pantalla de inicio de sesión. Luego, desde
   Configuración, elige qué secciones puede ver cada colaborador/a.

## Estructura del proyecto

```
index.html                       la app completa (React + Firebase, sin build)
manifest.json / sw.js            configuración de la PWA y caché offline
icon-192.png / icon-512.png      íconos de la app
firestore.rules                  reglas de seguridad para copiar en Firebase
notificaciones-robot/            robot de GitHub Actions para los recordatorios
.github/workflows/               flujo programado que ejecuta el robot
```

## Nota sobre privacidad

Esta app maneja información médica sensible. Antes de usarla con pacientes
reales, confirma que el uso de Firebase/Cloudinary y el manejo de estos
datos cumple con la normativa de protección de datos de salud de tu país
(por ejemplo, habilitar cifrado, revisar quién tiene acceso al proyecto de
Firebase, y tener un aviso de privacidad para tus pacientes).
