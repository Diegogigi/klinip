# Klinip v0.7.7: esquema y migraciones propuestas

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Fecha: 2026-08-02
- Base inspeccionada: Alembic con un único head `20260727_000001`
- Contrato: [Cloud y dispositivo](../contracts/reminders_cloud_device_contract_v0.7.7.md)
- Decisiones: [ADR-003](../decisions/ADR-003-reminders-domain-and-delivery.md),
  [ADR-004](../decisions/ADR-004-reminders-runtime-security-and-retention.md) y
  [ADR-005](../decisions/ADR-005-reminders-time-offline-and-multidevice-policy.md)

## Alcance

Este documento describe un esquema futuro. No contiene SQL, archivos Alembic,
modelos SQLAlchemy ni cambios de PostgreSQL. Antes de implementarlo se debe volver
a consultar el head real; ninguna migración puede asumir que
`20260727_000001` seguirá siendo el padre.

Ninguna de las tablas descritas a continuación existe todavía.

El bounded context `reminders` es independiente de `ProfileNote.reminder_at`,
citas, medicamentos y Device Messages.

## Convenciones de persistencia

- primary key interna numérica y `public_id` opaco único para API;
- foreign keys internas nunca expuestas al dispositivo;
- timestamps normalizados a UTC conforme a la convención actual del repositorio;
- fecha/hora civil y zona IANA conservadas por separado;
- optimistic `version` desde 1;
- estados limitados por check constraints;
- JSON solo para estructuras versionadas y allowlists, no para ocultar relaciones;
- borrado lógico y retención; no cascadas destructivas sobre auditoría;
- índices sobre selección operativa, nunca sobre texto humano cifrado;
- constraints como última defensa, además de locks e idempotencia de servicio.

## Tabla propuesta: `reminder_profile_settings`

Responsabilidad: configuración de recordatorios por perfil, incluida la autoridad
temporal y el dispositivo preferido. Representa en el dominio la propiedad
`HealthProfile.timezone_iana` definida por ADR-005 sin mezclarla con datos
clínicos del perfil.

| Campo | Tipo conceptual | Nulabilidad | Regla |
|---|---|---:|---|
| `id` | integer | No | PK interna |
| `health_profile_id` | FK integer | No | Unique; `health_profiles.id`, RESTRICT |
| `timezone_iana` | string(80) | No | Identificador IANA validado |
| `preferred_device_id` | FK integer | Sí | `devices.id`; debe tener grant activo al perfil |
| `active_hours_enabled` | boolean | No | Default true propuesto |
| `active_hours_start_local` | time | Sí | Requerido si enabled |
| `active_hours_end_local` | time | Sí | Requerido si enabled |
| `active_weekdays_json` | JSON array | No | Enteros únicos 1..7 |
| `settings_version` | integer | No | Mayor que cero |
| `created_at` | datetime UTC | No | Inmutable |
| `updated_at` | datetime UTC | No | Cambia con optimistic version |

Índices y restricciones:

- unique `health_profile_id`;
- índice de `preferred_device_id`;
- check de versión positiva;
- servicio valida que el dispositivo no esté revocado y que su grant corresponda
  al mismo perfil;
- al revocar un device, `preferred_device_id` pasa a null y el perfil queda sin
  target; no se elige otro silenciosamente.

Cifrado por campo: no contiene texto de recordatorio. La zona y horario son datos
personales operativos; se protegen mediante controles de acceso y cifrado de
almacenamiento. Cifrado aplicativo adicional queda pendiente de revisión de
privacidad antes de la migración.

Retención: mientras exista el perfil. Al eliminarlo sigue su proceso de borrado.

## Tabla propuesta: `reminders`

Responsabilidad: definición estable y versionada de una intención personal no
clínica.

| Campo | Tipo conceptual | Nulabilidad | Regla |
|---|---|---:|---|
| `id` | integer | No | PK interna |
| `public_id` | string(64) | No | Unique, opaco |
| `health_profile_id` | FK integer | No | Perfil propietario, RESTRICT |
| `created_by_user_id` | FK integer | Sí | Actor humano, RESTRICT |
| `created_by_device_id` | FK integer | Sí | Actor device, RESTRICT |
| `idempotency_key_hash` | string(64) | No | HMAC server-side de la key |
| `request_fingerprint` | string(64) | No | Hash canónico del comando |
| `origin` | string(32) | No | `web`, `voice`, `authorized_caregiver` |
| `reminder_type` | string(32) | No | Solo `personal_non_clinical` inicialmente |
| `title_ciphertext` | binary/text | No | Título cifrado por campo |
| `body_ciphertext` | binary/text | Sí | Detalle cifrado por campo |
| `content_nonce` | binary/string | No | Nonce único de la escritura |
| `content_key_version` | integer | No | Versión de clave, sin material secreto |
| `schedule_mode` | string(24) | No | Solo `wall_clock` inicialmente |
| `original_local_date` | date | Sí | Requerido para one-time |
| `original_local_time` | time | No | Hora civil |
| `timezone_iana` | string(80) | No | Zona original |
| `recurrence_json` | JSON | No | Regla tipada con `version` |
| `dst_gap_policy` | string(32) | No | `shift_forward_by_gap` |
| `dst_fold_policy` | string(16) | No | `earlier` inicialmente |
| `target_mode` | string(24) | No | `selected_device` |
| `target_device_id` | FK integer | No | Device con grant activo al crear |
| `next_occurrence_at_utc` | datetime | Sí | Selección del materializador |
| `next_logical_key` | string(120) | Sí | Identidad civil de próxima ocurrencia |
| `state` | string(20) | No | Máquina de estados de definición |
| `version` | integer | No | Optimistic version |
| `expires_at` | datetime | Sí | Límite opcional |
| `created_at` | datetime | No | UTC |
| `updated_at` | datetime | No | UTC |
| `completed_at` | datetime | Sí | Solo one-time completado |
| `cancelled_at` | datetime | Sí | Cancelación lógica |

Restricciones:

- exactamente uno de `created_by_user_id` o `created_by_device_id` debe existir;
- target y profile deben coincidir mediante validación transaccional del grant;
- estado permitido: `active`, `awaiting_device`, `completed`, `cancelled`,
  `expired`, `failed`;
- `version > 0`, `content_key_version > 0`;
- recurrencia incluye `once`, `daily` o `weekly`; no RRULE libre;
- no hay índice de búsqueda sobre ciphertext.

Índices:

- unique de `public_id`;
- `(health_profile_id, state, next_occurrence_at_utc)` para scheduler y UI;
- `(target_device_id, state)` para revocación/reasignación;
- `(health_profile_id, created_at, public_id)` para paginación estable;
- `created_by_user_id` y `created_by_device_id` para auditoría.

Idempotencia de creación se preserva con dos índices únicos parciales:

- `(created_by_user_id, health_profile_id, idempotency_key_hash)` para humanos;
- `(created_by_device_id, health_profile_id, idempotency_key_hash)` para devices.

La misma key solo reutiliza resultado si `request_fingerprint` coincide. Ningún
valor de idempotencia entregado por el cliente se usa sin HMAC/fingerprint.

Cifrado por campo propuesto: AES-GCM de título y body con AAD que incluya profile,
public ID, nombre de campo y schema version. La gestión de claves Cloud debe
aprobarse antes de implementar; no se guardan claves junto al ciphertext.

Retención propuesta: contenido terminal 30 días; después se redacta mediante
crypto-shredding y se conserva tombstone técnico hasta 180 días. Los valores no
son definitivos.

## Tabla propuesta: `reminder_occurrences`

Responsabilidad: una ejecución global concreta de la definición.

| Campo | Tipo conceptual | Nulabilidad | Regla |
|---|---|---:|---|
| `id` | integer | No | PK |
| `public_id` | string(64) | No | Unique |
| `reminder_id` | FK integer | No | RESTRICT |
| `health_profile_id` | FK integer | No | Copia defensiva para aislamiento |
| `schedule_version` | integer | No | Versión de definición materializada |
| `logical_occurrence_key` | string(120) | No | Identidad civil estable |
| `original_scheduled_for_utc` | datetime | No | Instante original |
| `scheduled_for_utc` | datetime | No | Instante vigente tras snooze |
| `original_local_date` | date | No | Evidencia civil |
| `original_local_time` | time | No | Evidencia civil |
| `timezone_iana` | string(80) | No | Evidencia de resolución |
| `tzdb_version` | string(40) | Sí | Versión usada si está disponible |
| `revision` | integer | No | Incrementa al posponer |
| `snooze_count` | integer | No | No negativo |
| `state` | string(20) | No | Máquina global |
| `due_at` | datetime | Sí | Primera transición a due |
| `terminal_at` | datetime | Sí | Acción terminal |
| `created_at` | datetime | No | UTC |
| `updated_at` | datetime | No | UTC |

Restricción principal contra doble ocurrencia:

- unique `(reminder_id, schedule_version, logical_occurrence_key)`.

`logical_occurrence_key` deriva de fecha civil, hora, fold y versión, no del
instante pospuesto. Por eso un snooze no crea otra ocurrencia lógica.

Checks:

- estado en `scheduled`, `due`, `snoozed`, `completed`, `dismissed`,
  `cancelled`, `expired`, `failed`;
- `revision > 0`, `snooze_count >= 0`;
- profile debe coincidir con el reminder, validado dentro de la transacción.

Índices:

- `(state, scheduled_for_utc, id)` para due scan;
- `(health_profile_id, scheduled_for_utc, public_id)` para consultas;
- `(reminder_id, created_at)`;
- `(state, updated_at)` para reconciliación y retención.

Cifrado: no duplica título ni body. Sus campos temporales no usan cifrado por
campo, pero están sujetos a acceso por perfil y cifrado de almacenamiento.

Retención propuesta: 180 días desde terminal; después tombstone mínimo según la
aprobación de privacidad.

## Tabla propuesta: `reminder_deliveries`

Responsabilidad: entrega versionada de una ocurrencia a un único dispositivo.

| Campo | Tipo conceptual | Nulabilidad | Regla |
|---|---|---:|---|
| `id` | integer | No | PK |
| `public_id` | string(64) | No | Unique |
| `occurrence_id` | FK integer | Sí | Requerido para occurrence y delivery events |
| `health_profile_id` | FK integer | No | Aislamiento defensivo |
| `device_id` | FK integer | No | Target exacto |
| `delivery_revision` | integer | No | Revisión del delivery |
| `occurrence_version` | integer | No | Versión esperada |
| `state` | string(20) | No | Estado de presentación |
| `available_at` | datetime | No | Inicio de visibilidad |
| `expires_at` | datetime | No | Fin de validez |
| `delivery_attempts` | integer | No | Conteo de `delivered` aceptados |
| `last_event_public_id` | string(64) | Sí | Trazabilidad, no FK circular |
| `state_at` | datetime | No | Última transición |
| `created_at` | datetime | No | UTC |
| `updated_at` | datetime | No | UTC |
| `revoked_at` | datetime | Sí | Revocación/cancelación de target |

Restricción principal contra doble entrega:

- unique `(occurrence_id, device_id, delivery_revision)`.

Checks:

- estado en `queued`, `delivered`, `announced`, `superseded`, `failed`,
  `expired`, `cancelled`;
- revisiones positivas, intentos no negativos;
- device grant activo y profile coincidente al crear el delivery.

Índices:

- `(device_id, state, available_at, public_id)` para inbox;
- `(occurrence_id, delivery_revision)`;
- `(device_id, expires_at)` para expiración y revocación;
- `(health_profile_id, state_at)` para soporte saneado.

Cifrado: no duplica contenido. El inbox hace join controlado con `reminders`
después de autenticar device/profile.

Retención propuesta: 180 días desde estado terminal.

## Tabla propuesta: `reminder_events`

Responsabilidad: ledger inmutable de eventos de delivery y acciones globales.
Una sola tabla mantiene orden causal y auditoría, con columnas explícitas para
scope y actor.

| Campo | Tipo conceptual | Nulabilidad | Regla |
|---|---|---:|---|
| `id` | integer | No | PK |
| `public_id` | string(64) | No | Unique |
| `reminder_id` | FK integer | No | RESTRICT |
| `occurrence_id` | FK integer | No | RESTRICT |
| `delivery_id` | FK integer | Sí | Requerido para delivery events |
| `health_profile_id` | FK integer | No | Aislamiento |
| `actor_kind` | string(16) | No | `user`, `device`, `worker` |
| `actor_user_id` | FK integer | Sí | Actor humano |
| `actor_device_id` | FK integer | Sí | Actor device |
| `event_scope` | string(16) | No | `reminder`, `delivery`, `occurrence`, `system` |
| `event_type` | string(24) | No | Allowlist por scope |
| `client_event_id` | string(64) | Sí | Obligatorio para cliente |
| `request_fingerprint` | string(64) | No | Conflicto idempotente |
| `expected_version` | integer | Sí | Control optimista |
| `resulting_state` | string(20) | No | Resultado aceptado |
| `resulting_version` | integer | No | Versión autoritativa |
| `client_timestamp` | datetime | Sí | Informativo |
| `server_timestamp` | datetime | No | Autoritativo |
| `error_code` | string(80) | Sí | Allowlist saneada |
| `metadata_json` | JSON | No | Solo claves permitidas |
| `created_at` | datetime | No | UTC |

Restricciones contra doble evento:

- unique parcial `(reminder_id, actor_user_id, client_event_id)` para edición o
  cancelación humana de la definición;
- unique parcial `(delivery_id, actor_device_id, client_event_id)` para eventos
  de delivery;
- unique parcial `(occurrence_id, actor_user_id, client_event_id)` para acciones
  humanas;
- unique parcial `(occurrence_id, actor_device_id, client_event_id)` para acciones
  de dispositivo;
- mismo ID y fingerprint devuelve el evento existente;
- mismo ID con fingerprint distinto produce conflicto;
- exactamente un actor humano/device para eventos de cliente; worker usa ambos
  null y un event ID generado por servidor.

Tipos permitidos:

- reminder: `updated`, `cancelled`;
- delivery: `delivered`, `announced`, `failed`;
- occurrence: `completed`, `snoozed`, `dismissed`;
- system: `materialized`, `due`, `expired`, `cancelled`, `superseded`.

Índices:

- `(occurrence_id, server_timestamp, id)`;
- `(delivery_id, server_timestamp, id)`;
- `(health_profile_id, server_timestamp, id)`;
- `(actor_device_id, server_timestamp)` para revocación/auditoría;
- `client_event_id` nunca se usa solo para buscar entre perfiles.

Cifrado: metadata no admite texto humano. No se guarda contenido, transcript ni
audio. Retención propuesta: 180 días; auditoría mínima de seguridad podría
conservarse 365 días sin contenido, sujeto a aprobación.

## Permisos y scopes: cambios sin tabla nueva

No se propone una tabla de permisos en v0.7.7 porque el repositorio ya utiliza
`ProfileRelationship.permissions_json` y `DeviceGrant.scopes_json`.

La futura migración de aplicación deberá:

- extender `VALID_PERMISSIONS` y el catálogo visible con los cinco permisos;
- no agregar permisos de recordatorios al default de caregiver o viewer;
- extender `DEVICE_SCOPES` con los tres scopes;
- aumentar el límite de scopes solicitado por pairing;
- mantener grants existentes sin scopes nuevos;
- exigir reautorización explícita para ampliar un grant;
- probar separación token humano/device en ambos sentidos.

## Orden propuesto de migración

### Revisión 1: estructura aditiva

- verificar un único Alembic head real;
- crear settings, reminders, occurrences, deliveries y events;
- agregar FKs, checks, unique constraints e índices;
- no backfill de recordatorios desde notas, citas, medicamentos o mensajes;
- mantener feature flags desactivadas.

### Revisión 2: catálogo y configuración

- incorporar permisos/scopes en código de aplicación, no mediante SQL manual;
- crear settings solo cuando un perfil configure recordatorios;
- no asignar preferred device automáticamente si hay más de uno;
- permitir backfill de timezone solo tras validación IANA y confirmación humana.

### Revisión 3: retención y cifrado

- habilitar escritura de ciphertext solo cuando exista gestión de claves aprobada;
- no migrar contenido real en una transacción no acotada;
- activar pruning únicamente después de dry-run y métricas;
- conservar rollback lógico mediante feature flags.

Estas revisiones son una secuencia conceptual. La implementación puede agrupar o
separar revisiones tras medir locks y tiempo, pero nunca crear tablas parciales.

## Concurrencia y carreras

| Riesgo | Defensa obligatoria |
|---|---|
| Dos workers materializan | Advisory lock + row lock + unique logical occurrence |
| Reintento tras commit incierto | Restricción única y lectura del resultado existente |
| Dos deliveries iguales | Unique occurrence/device/revision |
| Evento repetido | Unique client event + fingerprint |
| Dos acciones terminales | Row lock occurrence + expected version |
| Snooze simultáneo | Una versión gana; otra recibe conflicto |
| Device de otro perfil | Join profile/grant dentro de la transacción |
| Edición mientras materializa | Row lock reminder + schedule version |
| Revocación durante inbox | Revalidar device/grant antes de responder/escribir |

Las constraints son autoritativas. Un advisory lock reduce colisiones, pero no es
la única defensa.

## Auditoría y logs

Auditoría persistente: actor, entidad pública, acción, transición, versión,
resultado, timestamp y reason code tipado. Logs operativos: contadores, latencia,
lag, intentos, conflictos y error class.

Nunca registrar título, body, nombres, audio, transcript, dirección, coordenadas,
tokens, claves, ciphertext completo ni payload libre.

## Rollback propuesto

- apagar creación y materialización con flags;
- mantener lectura/acciones para drenar ocurrencias ya aceptadas;
- no ejecutar downgrade destructivo en producción;
- no borrar tablas ni filas manualmente;
- preservar ledger para análisis y aplicar retención aprobada;
- revocar dispositivos de prueba y eliminar sus claves/datos mediante flujo
  oficial después de la validación.

## Validaciones pendientes

- estrategia de claves Cloud y cifrado aplicativo;
- valores definitivos de retención;
- timezone inicial de perfiles existentes;
- reautorización de scopes para devices vinculados;
- costo de índices y migración en copia de datos saneada;
- Huawei/EMUI, TTS bloqueado, exact alarm y batería;
- integración solo después del handoff estable de v0.7.6.
