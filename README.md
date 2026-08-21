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
próximas y manda una notificación push cuando falta poco. Se ejecuta solo,
cada 5 minutos, con GitHub Actions — no necesitas un servidor propio.

1. En Firebase Console → **Configuración del proyecto → Cuentas de
   servicio → Generar nueva clave privada**. Se descarga un archivo JSON.
2. En tu repositorio de GitHub: **Settings → Secrets and variables →
   Actions → New repository secret**.
   - Nombre: `FIREBASE_SERVICE_ACCOUNT_JSON`
   - Valor: pega el contenido completo del archivo JSON descargado.
3. Listo — el flujo `.github/workflows/revisar-citas.yml` ya está incluido
   y empezará a correr solo. Puedes probarlo a mano desde la pestaña
   **Actions** de tu repositorio → "Revisar citas próximas y enviar
   notificaciones" → **Run workflow**.

Por defecto asume que el consultorio está en la zona horaria de Ecuador
(UTC-5). Si estás en otro país, cambia `DESFASE_HORAS` al inicio de
`notificaciones-robot/revisar-citas.js`.

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
