# Klinip Cloud v0.7.5: Family Messaging UI and Personal Device Pairing

Fecha: 2026-07-30

Repositorio: `Diegogigi/klinip`

Rama: `feature/v0.7.5-cloud-family-messaging-ui`

Base: `5f19ef096b5799b8eb4392fe746497caca8e7ffb`

## 1. Alcance

Esta iteración agrega a Klinip Cloud una experiencia web autenticada para:

- generar y cancelar códigos temporales de vinculación;
- consultar, renombrar y revocar dispositivos Klinip One;
- enviar mensajes familiares no clínicos;
- consultar su progreso con lenguaje humano;
- distinguir mensajes escuchados de mensajes confirmados.

Klinip One no fue modificado. Railway y PostgreSQL de producción permanecieron
sin cambios.

## 2. Autorización

Todas las acciones parten de la sesión humana existente:

`authenticated_user -> authorized_health_profile -> authorized_operation`

Para dispositivos:

- owner y admin aceptado pueden administrar;
- caregiver aceptado necesita `manage_devices`;
- viewer no puede administrar.

Para mensajes:

- owner y admin aceptado pueden enviar y consultar;
- caregiver aceptado necesita `send_device_messages`;
- viewer no puede enviar ni consultar.

La interfaz filtra perfiles según los permisos recibidos, pero el backend sigue
siendo la autoridad final. No existe acceso por email, bypass administrativo,
contraseña embebida ni credencial hardcodeada.

## 3. Endpoints reutilizados

Sesión y perfiles humanos:

- `POST /auth/register`
- `POST /auth/login`
- `GET /health-profiles`

Pairing:

- `POST /api/v1/device-pairings`
- `GET /api/v1/device-pairings/{pairing_id}`
- `DELETE /api/v1/device-pairings/{pairing_id}`
- `POST /api/v1/devices/claim`

Dispositivos:

- `GET /api/v1/devices`
- `GET /api/v1/devices/{device_id}`
- `DELETE /api/v1/devices/{device_id}`

Mensajes humanos:

- `POST /api/v1/health-profiles/{profile_id}/device-messages`
- `GET /api/v1/health-profiles/{profile_id}/device-messages`
- `GET /api/v1/health-profiles/{profile_id}/device-messages/{message_id}`
- `DELETE /api/v1/health-profiles/{profile_id}/device-messages/{message_id}`

Mensajes del dispositivo:

- `GET /api/v1/device/messages`
- `POST /api/v1/device/messages/{message_id}/events`

## 4. Endpoint mínimo agregado

La auditoría confirmó que no existía un contrato para cambiar el nombre visible
de un dispositivo. Se agregó:

`PATCH /api/v1/devices/{device_id}`

Payload:

```json
{
  "label": "Klinip One sala"
}
```

El nombre se normaliza, exige entre 1 y 120 caracteres, usa la misma autorización
de administración de dispositivos y rechaza dispositivos revocados con `409`.
La acción genera auditoría `device_label_updated`. No se agregó migración porque
el campo `Device.label` ya existía.

## 5. Contrato de pairing para Klinip One

Klinip Cloud crea un pairing con protocolo 1, TTL de 300 segundos y estos scopes:

```text
device:read_config
profile:read_basic
device:refresh
device:heartbeat
messages:read
messages:ack
```

La respuesta de creación contiene una sola vez `pairing_code`. La UI web no
muestra `pairing_id`, tokens, hashes ni credenciales.

Klinip One debe:

1. solicitar al usuario el código;
2. llamar `POST /api/v1/devices/claim`;
3. persistir sus credenciales con el almacenamiento seguro ya definido;
4. no registrar access token, refresh token ni pairing code;
5. iniciar config, heartbeat e inbox solo después de un claim aprobado.

Estados de pairing: `pending`, `claimed`, `expired`, `cancelled`.

## 6. Contrato de mensajes

La creación humana exige `Idempotency-Key`. La interfaz:

- deshabilita el envío mientras la petición está pendiente;
- conserva la misma clave durante un reintento de red;
- crea una clave nueva después de éxito o cancelación;
- limita el cuerpo a 1.000 caracteres;
- permite elegir un dispositivo o todos los elegibles;
- permite solicitar confirmación;
- permite vencimiento de 1, 7 o 30 días.

El tipo sigue siendo exclusivamente `family_non_clinical`. Esta interfaz no
implementa prescripciones, diagnósticos, urgencias, citas, medicamentos,
WhatsApp, adjuntos ni mensajes clínicos.

## 7. Semántica de entrega

El orden obligatorio del cliente Klinip One permanece:

`DESCARGAR -> VALIDAR -> PERSISTIR LOCALMENTE -> COMMIT LOCAL -> DELIVERED`

Descargar el inbox nunca marca un mensaje como entregado o escuchado. Los eventos
son explícitos e independientes:

`queued -> delivered -> announced -> heard -> acknowledged`

- `heard`: Klinip One terminó de leer el mensaje.
- `acknowledged`: la persona aceptó confirmar que lo recibió.
- leer nunca confirma automáticamente;
- una lectura interrumpida no debe emitir `heard`;
- `acknowledged` solo corresponde si el mensaje lo requiere y el estado permite
  la transición.

La UI traduce los estados a:

- Pendiente de entrega;
- Entregado al dispositivo;
- Anunciado;
- Escuchado;
- Escuchado · Pendiente de confirmar;
- Confirmado;
- Revocado;
- Vencido.

## 8. Variables y ejecución local

Backend aislado:

```powershell
$env:DATABASE_URL="sqlite:///C:/temp/klinip-local.db"
cd C:\Users\hp\Desktop\Klinip\backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
$env:VITE_API_URL="http://127.0.0.1:8000"
cd C:\Users\hp\Desktop\Klinip\frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

URLs:

- frontend: `http://127.0.0.1:5173`
- backend: `http://127.0.0.1:8000`
- OpenAPI local: `http://127.0.0.1:8000/docs`

No usar una `DATABASE_URL` de producción para este flujo.

## 9. Fixture ficticio

Crear una cuenta local exclusivamente ficticia:

```powershell
$body = @{
  name = "Maria Fixture"
  email = "maria.fixture@example.com"
  password = "Fixture-password-123"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8000/auth/register" `
  -ContentType "application/json; charset=utf-8" `
  -Body $body
```

El registro crea el perfil primario ficticio. Luego se inicia sesión desde la web
y se abre `Klinip One` en la navegación lateral. En móvil, también existe acceso
desde `Familia -> Klinip One`.

## 10. Flujo de prueba

1. Iniciar sesión con el fixture local.
2. Abrir `Klinip One`.
3. Seleccionar el perfil ficticio.
4. Generar el código.
5. Reclamarlo desde un cliente local de prueba o Klinip One configurado contra
   el mismo backend local.
6. Confirmar que el dispositivo aparece vinculado.
7. Cambiar su nombre.
8. Enviar:
   - `Mensaje de prueba uno`;
   - `Voy a visitarte en la tarde`;
   - `Cuando puedas, confirma que recibiste este mensaje.`
9. Descargar el inbox varias veces y confirmar que sigue `queued`.
10. Enviar eventos explícitos y revisar su traducción en la web.
11. Revocar el dispositivo.
12. Confirmar que sus tokens dejan de acceder al backend.

## 11. Validación realizada

Flujo local aislado aprobado:

- pairing reclamado una sola vez;
- un dispositivo listado y renombrado;
- tres mensajes creados;
- dos descargas sucesivas conservaron estado `queued`;
- transición explícita hasta `acknowledged`;
- revocación aprobada;
- token del dispositivo revocado recibió `401`.

Suites:

- backend: `399 passed`;
- frontend: `16 passed`;
- build Vite: aprobado;
- `git diff --check`: aprobado.

Las pruebas frontend cubren permisos presentacionales, estados humanos, pairing
sin IDs internos, prevención de doble envío, accesibilidad básica y reglas de
dispositivo sin conexión. El CSS incluye reglas específicas para escritorio,
móvil compacto, tema claro, tema oscuro y movimiento reducido.

## 12. Seguridad y privacidad

- No se muestran IDs técnicos.
- No se almacenan contraseñas en la interfaz.
- No se registran códigos, tokens o cuerpos de mensajes.
- La clave idempotente no se muestra ni se persiste.
- La revocación conserva el historial de auditoría.
- Los endpoints humanos y de dispositivo mantienen autenticadores separados.
- Los datos locales de prueba deben eliminarse al finalizar.

## 13. Limitaciones

- No se agregó push; el dispositivo conserva polling acotado.
- El estado `Sin conexión` en la web se deriva de cinco minutos sin heartbeat.
- No existe conversación, WhatsApp ni contenido clínico en esta UI.
- La inspección visual automatizada con navegador no estuvo disponible en la
  sesión local; la paridad de temas, responsive y accesibilidad se validaron por
  CSS, componentes, pruebas DOM y build.
- La validación física con Klinip One corresponde al repositorio y proceso de
  Claude Code, usando únicamente este contrato y un backend local.

## 14. Limpieza

Después de las pruebas:

1. revocar todos los dispositivos ficticios;
2. detener backend y frontend locales;
3. borrar la base SQLite temporal;
4. no conservar tokens ni códigos en documentos o logs;
5. no realizar merge ni despliegue sin autorización explícita.

## 15. Corrección posterior a revisión visual

La revisión local del PR #26 detectó que el envío desde el navegador no llegaba
al endpoint. El diagnóstico fue:

- endpoint previsto: `POST /api/v1/health-profiles/{profile_id}/device-messages`;
- respuesta observada: `OPTIONS` con HTTP `400`;
- código de aplicación: no aplicaba, porque el navegador detenía la solicitud
  antes del `POST`;
- causa raíz: el frontend envía el encabezado obligatorio `Idempotency-Key`,
  pero la configuración CORS solo autorizaba `Authorization`, `Content-Type` y
  `Accept`;
- corrección: se agregó `Idempotency-Key` a la lista explícita de encabezados
  CORS y una prueba de regresión del preflight.

La opción `Todos los dispositivos vinculados` sí corresponde al contrato:
`target_device_ids: null` crea un solo mensaje idempotente y el backend determina
todos los dispositivos elegibles dentro de la misma transacción. No se realizan
llamadas individuales desde el frontend.

La interfaz quedó organizada en una portada con tres acciones:

1. `Enviar mensaje`;
2. `Ver mensajes enviados`;
3. `Dispositivos vinculados`.

El envío usa cuatro pasos: persona, mensaje, confirmación y revisión. La lista de
mensajes muestra un estado principal y mantiene actividad y revocación dentro
del detalle. Los controles principales tienen al menos 48 px y existen reglas
específicas para una columna móvil, acciones de paso persistentes y paridad entre
tema claro y oscuro.

Prueba real local posterior a la corrección:

- preflight: HTTP `200`;
- encabezado CORS: incluye `Idempotency-Key`;
- creación: HTTP `201`;
- destinatarios: `1`;
- estado inicial: `queued`;
- resultado idempotente reutilizado: `false`.
