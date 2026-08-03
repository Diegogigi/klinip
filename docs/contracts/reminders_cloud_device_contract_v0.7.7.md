# Klinip v0.7.7: contrato Cloud y dispositivo para recordatorios

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Fecha: 2026-08-02
- Protocolo de recordatorios propuesto: `1`
- Depende de: [ADR-003](../decisions/ADR-003-reminders-domain-and-delivery.md),
  [ADR-004](../decisions/ADR-004-reminders-runtime-security-and-retention.md) y
  [ADR-005](../decisions/ADR-005-reminders-time-offline-and-multidevice-policy.md)

## Propósito y límites

Este documento define el contrato que una implementación futura podría compartir
entre Klinip Cloud y Klinip One. No describe endpoints disponibles actualmente y
no autoriza modelos, migraciones, rutas, scopes, UI, scheduler ni despliegue.

El dominio es exclusivamente `personal_non_clinical`. No incluye citas,
medicamentos, adherencia, instrucciones clínicas ni Family Messaging. Los
ejemplos son ficticios y no contienen datos reales.

## Convenciones reales que se conservan

- rutas de módulos nuevos bajo `/api/v1`;
- autenticación humana mediante `auth.get_current_user`;
- autenticación de dispositivo mediante `DevicePrincipal` y token
  `type=device_access`;
- rechazo cruzado: un token humano no autentica un endpoint de dispositivo y un
  token de dispositivo no autentica un endpoint humano;
- errores con `detail` estable, sin contenido sensible;
- identificadores públicos opacos;
- `Idempotency-Key` para comandos humanos de creación;
- `client_event_id` más fingerprint para eventos y acciones del dispositivo;
- cursores firmados, ligados a dispositivo, perfil, dominio y versión;
- timestamps de intercambio en UTC ISO-8601; intención civil con zona IANA.

### Frontera de contenido y cifrado

`title` y `body` viajan como strings JSON sobre TLS solo despues de autenticar y
autorizar al actor. El envelope `content_ciphertext` de PostgreSQL es interno de
Cloud, protege un unico objeto JSON `{title, body}` en reposo y nunca forma parte
del contrato Device. Klinip One cifra nuevamente el contenido para su reposo
local con claves propias; ambos dominios criptograficos son independientes.

No existe fallback de persistencia plaintext. PR A solo congela la forma del
envelope; gestion de claves, cifrado/descifrado y activacion de escrituras siguen
sin implementar.

Family Messaging es una referencia de infraestructura, no una tabla, endpoint ni
máquina de estados que deba reutilizarse para recordatorios.

### Cero confianza en identificadores del cliente

Todo ID recibido se resuelve dentro del actor autenticado y su perfil autorizado.
El servidor no confía en `profile_id`, `device_id`, `reminder_id`,
`occurrence_id` ni `delivery_id` solo porque aparezcan en una ruta o payload.
Cada consulta exige joins con profile, grant, target y estado vigente. Un ID de
otro perfil devuelve el mismo `404` opaco que un ID inexistente.

## Autenticación, permisos y scopes

### Permisos humanos propuestos

| Permiso | Capacidad |
|---|---|
| `view_reminders` | Listar y consultar definiciones, ocurrencias y estado |
| `create_reminders` | Crear recordatorios personales no clínicos |
| `edit_reminders` | Editar futuras ocurrencias mediante control de versión |
| `cancel_reminders` | Cancelar una definición activa |
| `complete_reminders` | Completar o descartar una ocurrencia desde la web |

Owner y admin tendrían todos los permisos. Caregiver solo recibiría permisos
concedidos explícitamente. Viewer podría recibir únicamente `view_reminders`.
No se reutilizan `send_device_messages`, permisos de citas ni medicamentos.

### Scopes de dispositivo propuestos

| Scope | Capacidad |
|---|---|
| `reminders:read` | Descargar entregas propias y reportar `delivered`, `announced` o fallo de presentación |
| `reminders:act` | Enviar `completed`, `snoozed` y `dismissed` sobre ocurrencias asignadas |
| `reminders:create` | Crear desde un draft estructurado confirmado por voz |

Los scopes se agregarían al catálogo existente de Device Identity. No se
concederían automáticamente a dispositivos ya vinculados: la ampliación exige
autorización humana explícita o una nueva vinculación. Un scope nunca amplía el
perfil contenido en el `DeviceGrant`.

## Configuración propuesta del dispositivo

La ruta existente `GET /api/v1/device/config` seguiría usando
`device:read_config` y `profile:read_basic`. Su respuesta podría incorporar un
bloque versionado sin cambiar la separación de autenticación:

```json
{
  "reminders": {
    "status": "disabled",
    "protocol_version": 1,
    "timezone_iana": "Etc/UTC",
    "preferred_device": false,
    "active_hours": {
      "enabled": true,
      "start_local": "08:00",
      "end_local": "21:00",
      "weekdays": [1, 2, 3, 4, 5, 6, 7]
    },
    "capabilities": [
      "reminder_inbox_v1",
      "local_notification_v1"
    ]
  }
}
```

Estado de esta extensión: **PROPOSED — NOT IMPLEMENTED**.

`timezone_iana` representa la autoridad civil del perfil. `preferred_device`
indica si el dispositivo autenticado es el destino predeterminado. Las
capabilities se derivan del heartbeat y nunca conceden scopes. `active_hours`
restringe presentación y TTS, no materialización ni persistencia. TTS con
pantalla bloqueada no aparece como capability hasta validarlo físicamente.

## Resumen de endpoints propuestos

| Método | Ruta | Actor | Autorización |
|---|---|---|---|
| `POST` | `/api/v1/health-profiles/{profile_id}/reminders` | Humano | `create_reminders` |
| `GET` | `/api/v1/health-profiles/{profile_id}/reminders` | Humano | `view_reminders` |
| `GET` | `/api/v1/health-profiles/{profile_id}/reminders/{reminder_id}` | Humano | `view_reminders` |
| `PATCH` | `/api/v1/health-profiles/{profile_id}/reminders/{reminder_id}` | Humano | `edit_reminders` |
| `POST` | `/api/v1/health-profiles/{profile_id}/reminders/{reminder_id}/cancel` | Humano | `cancel_reminders` |
| `GET` | `/api/v1/health-profiles/{profile_id}/reminders/{reminder_id}/occurrences` | Humano | `view_reminders` |
| `GET` | `/api/v1/device/reminders` | Dispositivo | `reminders:read` |
| `POST` | `/api/v1/device/reminder-deliveries/{delivery_id}/events` | Dispositivo | `reminders:read` |
| `POST` | `/api/v1/device/reminder-occurrences/{occurrence_id}/actions` | Dispositivo | `reminders:act` |
| `POST` | `/api/v1/device/reminders` | Dispositivo | `reminders:create` |

Todos los endpoints de esta tabla están **PROPOSED — NOT IMPLEMENTED**.

## Contratos humanos

### Crear recordatorio

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Método y ruta: `POST /api/v1/health-profiles/{profile_id}/reminders`
- Actor: humano autenticado.
- Permiso: `create_reminders` sobre el perfil.
- Idempotencia: header `Idempotency-Key` obligatorio, máximo 200 caracteres.
- Auditoría: actor, perfil, resultado, ID público y timestamp; nunca contenido.

Request propuesto:

```json
{
  "protocol_version": 1,
  "title": "Cerrar la ventana",
  "body": null,
  "schedule": {
    "mode": "wall_clock",
    "local_date": "2030-03-15",
    "local_time": "19:00",
    "timezone_iana": "America/Santiago",
    "recurrence": {
      "version": 1,
      "frequency": "once",
      "interval": 1,
      "weekdays": []
    }
  },
  "target": {
    "mode": "preferred_device",
    "device_id": null
  }
}
```

Response `201` propuesto: definición serializada, `version=1`, próxima ocurrencia
UTC resuelta, resumen civil y `reused_idempotency_result`. La misma key con el
mismo fingerprint devuelve el mismo resultado; con payload diferente devuelve
`409 idempotency_conflict`.

`preferred_device` es un selector del request. Antes del commit, el servidor lo
resuelve al dispositivo preferido vigente y persiste `target_mode=selected_device`
más un `target_device_id` concreto. Nunca se conserva un target ambiguo ni se
elige otro dispositivo silenciosamente.

Errores principales: `400 idempotency_key_required`, `401`,
`403 profile_not_authorized`, `403 insufficient_permission`,
`409 idempotency_conflict`, `422 invalid_timezone`,
`422 invalid_recurrence`, `422 no_preferred_device` y `429`.

Privacidad: el request admite solo contenido mínimo no clínico. No se guarda
audio, transcripción, dirección ni coordenadas.

### Listar recordatorios

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Método y ruta: `GET /api/v1/health-profiles/{profile_id}/reminders`
- Actor y permiso: humano con `view_reminders`.
- Query: `state`, `created_from`, `created_to`, `limit` entre 1 y 100 y cursor
  opaco opcional.
- Response `200`: `items`, `next_cursor`, `has_more`, `server_time`.
- Idempotencia: lectura side-effect-free.
- Auditoría: acceso agregado sin contenido.
- Privacidad: no devuelve eventos técnicos completos en la lista.

Errores: `401`, `403 profile_not_authorized`, `400 invalid_cursor`, `422` y
`429`. El cursor queda ligado a usuario, perfil, filtros y protocolo.

### Consultar detalle y ocurrencias

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Rutas: detalle de definición y lista de ocurrencias indicadas en la tabla.
- Actor y permiso: humano con `view_reminders`.
- Response: definición, target, próxima ocurrencia, versión y estado humano; las
  ocurrencias exponen estado global y resumen por delivery sin secretos.
- Idempotencia: lecturas side-effect-free.
- Auditoría: lectura de detalle, sin duplicar contenido.
- Privacidad: `404 reminder_not_found` también se usa para IDs de otro perfil.

### Editar recordatorio

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Método y ruta: `PATCH` de la definición.
- Actor y permiso: humano con `edit_reminders`.
- Request: campos editables, `expected_version` obligatorio y
  `client_event_id`; nunca cambia perfil ni actor creador.
- Response `200`: nueva versión, próxima ocurrencia y deliveries superseded.
- Idempotencia: `(reminder_id, user_id, client_event_id)` más fingerprint.
- Auditoría: campos técnicos cambiados, sin valores de contenido.
- Privacidad: el contenido anterior sigue la retención propuesta.

Errores: `404`, `409 version_conflict`, `409 reminder_not_active`,
`409 client_event_id_conflict`, `422` y `429`.

### Cancelar recordatorio

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Método y ruta: `POST .../{reminder_id}/cancel`; se prefiere a `DELETE` porque
  cancelación es una transición auditable, no borrado físico inmediato.
- Actor y permiso: humano con `cancel_reminders`.
- Request: `expected_version`, `client_event_id` y reason code opcional saneado.
- Response: `accepted`, `duplicate`, estado `cancelled`, versión y hora servidor.
- Idempotencia: `(reminder_id, user_id, client_event_id)` más fingerprint; la
  misma acción devuelve el resultado original.
- Auditoría: actor, transición y razón tipada.
- Privacidad: la eliminación del contenido sigue ADR-004; no se borra
  manualmente PostgreSQL.

## Contratos de dispositivo

### Descargar recordatorios próximos o vencidos

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Método y ruta: `GET /api/v1/device/reminders`.
- Actor: `DevicePrincipal`; tokens humanos se rechazan.
- Scope: `reminders:read`.
- Query: `cursor`, `limit` 1..100, `protocol_version=1` e
  `include_terminal=false`.
- Idempotencia: lectura side-effect-free; descargar nunca marca `delivered`.
- Auditoría: device ID opaco, cantidad, latencia y resultado.
- Privacidad: solo deliveries del device y perfil contenidos en el grant.

Item mínimo propuesto:

```json
{
  "delivery_id": "delivery_demo_001",
  "occurrence_id": "occurrence_demo_001",
  "reminder_id": "reminder_demo_001",
  "title": "Cerrar la ventana",
  "body": null,
  "scheduled_for_utc": "2030-03-15T22:00:00Z",
  "original_local_date": "2030-03-15",
  "original_local_time": "19:00",
  "timezone_iana": "America/Santiago",
  "occurrence_version": 1,
  "delivery_revision": 1,
  "expires_at": "2030-03-16T22:00:00Z",
  "protocol_version": 1
}
```

`occurrence_id` es obligatorio: no existe delivery directa a una definicion. Los
campos `title` y `body` son plaintext de transporte protegido por TLS, no las
columnas cifradas internas de Cloud.

Response: `items`, cursor firmado, `has_more`, `server_time` y
`polling_hint_seconds`. Errores: `401 device_*`, `403 insufficient_device_scope`,
`400 invalid_cursor`, `422 protocol_not_supported`, `429` y `503`.

Orden obligatorio del consumidor:

```text
DESCARGAR
→ VALIDAR
→ PERSISTIR LOCALMENTE
→ COMMIT LOCAL
→ ENVIAR DELIVERED
```

Si falla la persistencia, no se avanza el cursor local ni se crea `delivered`.

### Reportar eventos de delivery

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Método y ruta: `POST /api/v1/device/reminder-deliveries/{delivery_id}/events`.
- Actor y scope: dispositivo destinatario con `reminders:read`.
- Eventos: `delivered`, `announced`, `failed`.
- Request: `client_event_id`, `event_type`, `client_timestamp`,
  `protocol_version`, `expected_delivery_revision`, `error_code` saneado.
- Response: `accepted`, `duplicate`, `delivery_state`, `occurrence_state`,
  `server_timestamp`, IDs coincidentes y versiones autoritativas.
- Idempotencia: unique `(delivery_id, device_id, client_event_id)` más fingerprint.
- Auditoría: transición, device y resultado sin texto.
- Privacidad: metadata allowlist; no transcript, audio ni excepción libre.

`delivered` solo sigue al commit local. `announced` solo sigue a TTS completo.
TTS interrumpido no crea `announced`. `failed` no completa ni descarta.

La nullability de eventos depende del scope: reminder exige `occurrence_id` y
`delivery_id` nulos; occurrence exige occurrence y delivery nulo; delivery exige
ambos IDs. Los valores de enums en JSON son siempre `snake_case` y no dependen de
los nombres internos del lenguaje cliente.

Eventos `system` son exclusivamente de worker y no llevan `client_event_id`.
`materialized`, `due`, `expired` y `cancelled` apuntan a una occurrence sin
delivery; `superseded` apunta a occurrence y delivery. Su idempotencia se congela
por target, tipo y `resulting_version`.

### Enviar acciones sobre la ocurrencia

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Método y ruta: `POST /api/v1/device/reminder-occurrences/{occurrence_id}/actions`.
- Actor y scope: dispositivo asignado con `reminders:act`.
- Acciones: `completed`, `snoozed`, `dismissed`.
- Request: `client_event_id`, `action`, `expected_version`, timestamp y parámetros
  tipados; `snoozed` requiere `duration_minutes` permitido.
- Response: aceptación, duplicado, estado global, nueva versión, nueva hora UTC
  cuando corresponda y estado de deliveries superseded.
- Idempotencia: unique `(occurrence_id, device_id, client_event_id)` más
  fingerprint.
- Auditoría: acción global, actor, versión y resultado.
- Privacidad: no se envía la frase reconocida; solo acción estructurada.

La primera acción terminal válida gana. Completar o descartar afecta la
ocurrencia global. Posponer incrementa su versión, supersede deliveries previos y
crea una revisión nueva. Una carrera devuelve `409 version_conflict` con estado
autoritativo saneado.

### Crear desde voz estructurada

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Método y ruta: `POST /api/v1/device/reminders`.
- Actor y scope: dispositivo con `reminders:create`.
- Request: el mismo draft estructurado del create humano más
  `local_draft_id`; nunca audio ni transcripción.
- Idempotencia: `Idempotency-Key` estable mientras el draft esté pendiente.
- Response: resultado de creación o estado `requires_attention`.
- Auditoría: dispositivo, perfil, resultado y códigos tipados.
- Privacidad: rechazar contenido clínico y payloads no estructurados.

Un draft creado offline no es un recordatorio activo. Cloud debe aceptarlo antes
de que Klinip One programe una alarma o confirme “quedó programado”.

## Estados y semántica de eventos

| Entidad | Estados propuestos |
|---|---|
| Reminder | `active`, `awaiting_device`, `completed`, `cancelled`, `expired`, `failed` |
| Occurrence | `scheduled`, `due`, `snoozed`, `completed`, `dismissed`, `cancelled`, `expired`, `failed` |
| Delivery | `queued`, `delivered`, `announced`, `superseded`, `failed`, `expired`, `cancelled` |

`completed`, `snoozed` y `dismissed` son eventos inmutables y acciones globales
sobre una ocurrencia. `delivered`, `announced` y `failed` describen un delivery.
Recordatorios no usan `heard` ni `acknowledged`.

Cada dispositivo mantiene un `ReminderDelivery` y estado de entrega separados.
La occurrence conserva el estado global; una acción global aceptada puede
superseder los deliveries restantes sin borrar su historial individual.

## Errores contractuales

| HTTP | `detail` propuesto | Uso |
|---:|---|---|
| 400 | `idempotency_key_required` | Falta key obligatoria |
| 400 | `invalid_cursor` | Cursor alterado, ajeno o incompatible |
| 401 | `device_authentication_required` | Endpoint device con token ausente/humano |
| 401 | `invalid_device_token` | Token device inválido o token version incorrecta |
| 401 | `device_revoked` | Dispositivo revocado |
| 403 | `profile_not_authorized` | Actor sin vínculo al perfil |
| 403 | `insufficient_permission` | Permiso humano ausente |
| 403 | `insufficient_device_scope` | Scope device ausente |
| 404 | `reminder_not_found` | ID inexistente o de otro perfil |
| 404 | `delivery_not_found` | Delivery no asignado al dispositivo |
| 409 | `idempotency_conflict` | Misma key con fingerprint distinto |
| 409 | `client_event_id_conflict` | Mismo evento con payload distinto |
| 409 | `version_conflict` | Optimistic version desactualizada |
| 409 | `invalid_state_transition` | Transición no permitida |
| 410 | `reminder_expired` | Entidad fuera de ventana válida |
| 422 | `protocol_not_supported` | Versión no compatible |
| 422 | `invalid_timezone` | Zona no IANA o no aceptada |
| 422 | `invalid_recurrence` | Regla temporal inválida |
| 422 | `no_preferred_device` | Falta target válido |
| 429 | `rate_limit_exceeded` | Límite por actor/dispositivo |
| 503 | `reminder_service_unavailable` | Fallo transitorio, reintentable |

Los mensajes no incorporan contenido, nombres, tokens, SQL ni trazas.

## Cursores y paginación

- cursor HMAC opaco con versión, timestamp estable y public ID de desempate;
- binding a actor, perfil, dispositivo cuando aplique, filtros, dominio
  `reminders` y protocol version;
- orden ascendente estable para inbox device; descendente para listas humanas;
- cursor inválido devuelve `400`, nunca se ignora silenciosamente;
- una página repetida devuelve los mismos items mientras no sean superseded;
- la descarga no crea eventos ni modifica intentos;
- Klinip One persiste página y cursor en una sola transacción local.

## Revocación, offline y reintentos

- revocar device invalida token/grant antes de consultar inbox o enviar acción;
- deliveries pendientes quedan cancelados o awaiting-device según la política
  global; no se reasignan silenciosamente;
- acciones ya aceptadas no se revierten por revocación posterior;
- outbox usa backoff acotado con jitter y conserva la misma idempotency key;
- HTTP `401`, `403`, `409` no se reintentan ciegamente;
- `429` respeta `Retry-After`; `503` y timeout son reintentables;
- al reconectar, primero se actualiza configuración/revocación, luego inbox y al
  final se drena outbox en orden causal;
- un draft offline puede expirar sin transformarse en Reminder.

## Versionado y compatibilidad

- `/api/v1` versiona la familia HTTP; `protocol_version` versiona payloads de
  dispositivo;
- campos aditivos opcionales no incrementan versión;
- cambios de semántica, estado o required fields sí requieren nueva versión;
- el servidor anuncia mínimo/máximo soportado en config y errores;
- un cliente desconocido recibe `protocol_not_supported`, no fallback ambiguo;
- capability no equivale a autorización y scope no equivale a capability.

Los fixtures canónicos ficticios están en
[`fixtures/reminders_v0.7.7.json`](fixtures/reminders_v0.7.7.json). Congelan
formas, nullability, timestamps UTC, recurrence v1 y enums `snake_case`; no
activan endpoints y nunca incluyen el envelope cifrado interno de Cloud.

## Criterios de aceptación futuros

- separación humana/dispositivo probada en ambos sentidos;
- inbox repetido side-effect-free;
- persistencia local fallida no produce `delivered` ni avanza cursor;
- evento repetido devuelve exactamente el resultado original;
- carrera entre dos dispositivos acepta una sola acción global;
- revocación bloquea descarga y acción;
- DST conserva zona IANA y logical occurrence key;
- logs y auditoría no contienen contenido humano;
- ningún contrato se activa hasta completar migraciones, flags y autorización.

## Decisiones aún pendientes

TTS con pantalla bloqueada, proceso eliminado, restricciones EMUI, exact alarm,
batería, hardware backing de Keystore, retención definitiva, privacidad final e
integración posterior a v0.7.6 permanecen sin validar.
