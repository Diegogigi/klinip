# Klinip v0.7.7: matriz de compatibilidad Cloud y dispositivo

- Fecha de auditoria: 2026-08-02
- Cloud: PR #30, `feature/v0.7.7-reminders-domain-migrations`,
  `5adb42de65c71cdd90b0e6387ebbdd9fa44663ed`
- Klinip One: PR #11, `feature/v0.7.7-reminders-local-foundation`,
  `3669116ca87a939c5768f98b5c30d663101df061`
- Estado: auditoria actualizada tras correcciones Cloud pre-merge; ambos PR
  siguen Draft y sin merge
- Alcance: modelos y persistencia. No cubre endpoints, connector, scheduler, TTS
  ni Android scheduling porque todavia no existen.

## Resultado ejecutivo

La separacion de entidades y las tres maquinas de estados son compatibles. La
recurrencia, la intencion civil con zona IANA y el modelo delivery por dispositivo
tambien coinciden conceptualmente.

La correccion pre-merge de PR #30 adopto un unico payload JSON cifrado y elimino
el riesgo de nonce compartido entre campos. La recomendacion actual es
**E. Fusionar PR #30 despues de CI y mantener PR #11 abierto**:

1. PR #30 persiste un solo `content_ciphertext` para `{title, body}`, con nonce,
   key version y algorithm version obligatorios. El envelope es Cloud-only.
2. PR #11 aun debe alinear nullability de targets, constraints de idempotencia,
   cursor transaccional y comportamiento de upsert. Hoy un evento reminder-scoped de
   Cloud no cabe en el modelo local y un retry con el mismo `client_event_id`
   pero distinto `id` puede duplicarse localmente.
3. Ambos deben acordar el codec de IDs, fechas, enums y cifrado antes del PR de
   connector. No se debe dejar que el connector invente estas reglas de forma
   implicita.

## Clasificacion

| Codigo | Significado |
|---|---|
| A | Compatible sin cambio |
| B | Diferencia intencional entre sistema de registro y cache |
| C | Ajuste documental |
| D | Ajuste menor de codigo |
| E | Bloqueante antes de merge |
| F | Diferible hasta el PR de connector, pero obligatorio antes de integracion |

## Convenciones de intercambio que deben quedar canonicas

| Concepto | Cloud | Klinip One | Regla futura | Clase |
|---|---|---|---|---|
| ID de API | `public_id`, string opaco de hasta 64 | `id`, string opaco | One persiste siempre el public ID, nunca la PK numerica Cloud | B |
| UUID | Tests Cloud usan UUIDv4; el esquema no exige UUID | Draft usa ID opaco prefijado, no UUIDv7 | No afirmar UUID exacto. Elegir UUIDv7 o declarar ID opaco versionado antes del connector | C |
| Datetime wire | ISO-8601 UTC con `Z` | `DateTime` UTC | Codec rechaza timestamps sin offset y normaliza a UTC | F |
| Datetime DB | `DateTime` bajo convencion UTC | epoch milliseconds UTC | Diferencia de almacenamiento intencional | B |
| Fecha civil | `date`, `YYYY-MM-DD` en API | `DateTime`, epoch ms en SQLite | Serializar como fecha, sin conversion de zona | F |
| Hora civil | `time`, `HH:mm` en API | string `HH:mm` | Validar formato estricto y no convertir a UTC | F |
| Zona | IANA validada con `zoneinfo` | string sin validacion IANA | Cloud autoritativo; One debe validar antes de activar un draft | D |
| Enum wire | `snake_case` | varios valores usan `camelCase` de `enum.name` | Codec explicito por enum; nunca serializar `.name` directamente | F |
| Version optimista | entero positivo | entero positivo | Cloud es autoritativo; no reemplazar una version local mayor con una menor | D |
| Recurrencia | JSON estructurado v1 | value object y JSON v1 | `version`, `frequency`, `interval`, `weekdays`, sin claves extra | A |

## Matriz por entidad

### 1. ReminderProfileSettings

Fuente de verdad: Cloud. Direccion normal: Cloud -> dispositivo. Los cambios
locales futuros deben enviarse como comando y solo consolidarse al ser aceptados.

| Cloud | Klinip One | Tipo/nullability y formato | Semantica | Compatibilidad / accion |
|---|---|---|---|---|
| `id` | no existe | integer interno / no | PK no expuesta | B: correcto |
| `health_profile_id` | `healthProfileId` | FK integer vs string opaco / no | aislamiento por perfil | B: mapear public profile ID, nunca PK |
| `timezone_iana` | `timezoneIana` | string / no / IANA | autoridad civil | D: agregar validacion IANA local |
| `preferred_device_id` | `preferredDeviceId` | FK integer vs string opaco / si | target predeterminado | B: resolver a public device ID |
| `active_hours_enabled` | `activeHoursEnabled` | boolean / no | limita presentacion, no materializacion | A |
| `active_hours_start_local` | `activeHoursStartLocal` | `time` vs `HH:mm` / si | inicio civil | A con codec |
| `active_hours_end_local` | `activeHoursEndLocal` | `time` vs `HH:mm` / si | fin civil | A con codec |
| `active_weekdays_json` | `activeWeekdays` | JSON array vs `List<int>`/CSV DB / no | ISO 1..7 unicos | A; CSV es detalle local |
| `settings_version` | `settingsVersion` | integer positivo / no | optimistic version | D: upsert local debe ignorar/rechazar stale |
| `created_at`, `updated_at` | `createdAt`, `updatedAt` | UTC datetime vs epoch ms / no | trazabilidad | B con codec |

### 2. Reminder / ReminderDefinition

Fuente de verdad: Cloud despues de aceptar una creacion. Direccion normal:
Cloud -> dispositivo; un `ReminderDraft` viaja dispositivo -> Cloud como comando,
no como entidad autoritativa.

| Cloud | Klinip One | Tipo/nullability y formato | Semantica | Compatibilidad / accion |
|---|---|---|---|---|
| `id` interno + `public_id` | `id` | integer + string vs string / no | identidad estable | B: One usa solo `public_id` |
| `health_profile_id` | `healthProfileId` | FK integer vs string / no | propietario | B con resolucion autenticada |
| `created_by_user_id` | `createdByUserId` | integer vs string / si | creador humano | B |
| `created_by_device_id` | `createdByDeviceId` | integer vs string / si | creador device | B |
| constraint de un creador | asserts de un creador | exactamente uno | procedencia | A, pero validar tambien al deserializar |
| `idempotency_key_hash` | no existe | hash HMAC server-side / no | deduplicacion create | B: no debe descargarse |
| `request_fingerprint` | no existe | SHA-256 canonico / no | conflicto de create | B: resultado server-only |
| `origin` | `origin` | snake_case vs Dart camelCase / no | web/voice/caregiver | F: codec explicito antes del connector |
| `reminder_type` | `reminderType` | snake_case vs Dart camelCase / no | solo personal no clinico | F: codec explicito antes del connector |
| `content_ciphertext` | envelopes locales por campo | blob JSON Cloud vs campos One | cifrado en reposo independiente | B: nunca se mapean entre si |
| `content_nonce` | nonce por campo local | uno por payload Cloud vs uno por campo One | nonce criptografico | A: cada frontera evita reutilizacion |
| `content_key_version` | key version por campo | integer positivo | rotacion independiente | B |
| `content_algorithm_version` | schema version AAD local | integer positivo | versiona codec Cloud | B; no es wire |
| tag AES-GCM | envelope local futuro | se definira anexado al ciphertext o por codec | autenticacion | C: cerrar con key management, antes de escritura |
| `schedule_mode` | `scheduleMode` | snake_case vs camelCase / no | wall clock | F: codec explicito antes del connector |
| `original_local_date` | `originalLocalDate` | date vs DateTime / si | fecha civil original | F: codec date-only |
| `original_local_time` | `originalLocalTime` | time vs `HH:mm` / no | hora civil original | A con codec |
| `timezone_iana` | `timezoneIana` | string IANA / no | ancla temporal | D: validar localmente |
| `recurrence_json` | `recurrence` | JSON/value object / no | regla v1 | D: One debe rechazar version/claves invalidas |
| `dst_gap_policy` | `dstGapPolicy` | snake_case vs camelCase / no | shift forward | F: codec explicito antes del connector |
| `dst_fold_policy` | `dstFoldPolicy` | string / no | earlier/fold 0 | A con codec |
| `target_mode` | no existe | `selected_device` / no | target ya resuelto | B: One solo necesita el device concreto |
| `target_device_id` | `targetDeviceId` | FK integer vs string / no | dispositivo exacto | B con public ID |
| `next_occurrence_at_utc` | `nextOccurrenceAtUtc` | UTC / si | proxima ejecucion | A con codec |
| `next_logical_key` | `nextLogicalKey` | string / si | identidad civil siguiente | A |
| `state` | `state` | mismos estados, `awaiting_device` difiere de `.name` | definicion logica | F: codec explicito antes del connector |
| `version` | `version` | integer positivo / no | optimistic version | D: upsert local no debe aceptar stale |
| `expires_at` | `expiresAt` | UTC / si | limite | A con codec |
| timestamps terminales | mismos campos | UTC / si | historial | A con codec |

### 3. ReminderOccurrence

Fuente de verdad: Cloud. Direccion normal: Cloud -> dispositivo. `completed`,
`snoozed` y `dismissed` viajan dispositivo -> Cloud como acciones, no como
reemplazos directos de la occurrence.

| Cloud | Klinip One | Tipo/nullability y formato | Semantica | Compatibilidad / accion |
|---|---|---|---|---|
| `id` + `public_id` | `id` | interno + opaco vs opaco / no | identidad | B |
| `reminder_id` | `reminderId` | FK integer vs public string / no | definicion padre | B |
| `health_profile_id` | `healthProfileId` | FK integer vs string / no | aislamiento | B |
| `schedule_version` | `scheduleVersion` | integer / no | version materializada | A |
| `logical_occurrence_key` | `logicalOccurrenceKey` | string / no | identidad civil estable | A |
| `original_scheduled_for_utc` | `originalScheduledForUtc` | UTC / no | instante original | A con codec |
| `scheduled_for_utc` | `scheduledForUtc` | UTC / no | instante vigente | A con codec |
| fecha/hora civil original | mismos campos | date/time vs DateTime/string / no | evidencia DST | F: codec date-only |
| `timezone_iana`, `tzdb_version` | mismos campos | string / no, si | evidencia de resolucion | A |
| `revision` | `revision` | integer positivo / no | cambia con snooze | A |
| `snooze_count` | `snoozeCount` | integer no negativo / no | contador global | A |
| `state` | `state` | mismos ocho strings | estado global | A |
| `due_at`, `terminal_at` | `dueAt`, `terminalAt` | UTC / si | transiciones | A con codec |
| `created_at`, `updated_at` | mismos campos | UTC / no | trazabilidad | B con codec |
| unique logica | unique logica | reminder + schedule version + logical key | evita doble ocurrencia | E: One usa REPLACE y puede cambiar el ID canonico; debe conservarlo o rechazar conflicto |

### 4. ReminderDelivery

Fuente de verdad: Cloud. Direccion normal: Cloud -> dispositivo. Los eventos
`delivered`, `announced` y `failed` viajan dispositivo -> Cloud.

| Cloud | Klinip One | Tipo/nullability y formato | Semantica | Compatibilidad / accion |
|---|---|---|---|---|
| `id` + `public_id` | `id` | interno + opaco vs opaco / no | identidad | B |
| `occurrence_id` | `occurrenceId` | Cloud no nulo; One nullable | padre obligatorio | E: hacerlo no nulo en One |
| `health_profile_id` | `healthProfileId` | FK integer vs string / no | aislamiento | B |
| `device_id` | `deviceId` | FK integer vs string / no | destinatario | B |
| `delivery_revision` | `deliveryRevision` | integer positivo / no | revision por device | A |
| `occurrence_version` | `occurrenceVersion` | integer positivo / no | version esperada | A; documentar que corresponde a `revision` |
| `state` | `state` | mismos siete strings | presentacion por device | A |
| `available_at`, `expires_at` | mismos campos | UTC / no | ventana de inbox | A con codec |
| `delivery_attempts` | `deliveryAttempts` | integer no negativo / no | delivered aceptados, no retries HTTP | C: renombrar/documentar antes de endpoints |
| `last_event_public_id` | `lastEventPublicId` | string / si | trazabilidad | A |
| `state_at`, timestamps | mismos campos | UTC | historial | A con codec |
| `revoked_at` | `revokedAt` | UTC / si | revocacion, no estado `revoked` | A |
| unique delivery | no existe localmente | occurrence + device + revision | deduplicacion | E: agregar constraint y test local |

### 5. ReminderEvent

Cloud es autoridad del resultado. One origina eventos device en outbox y conserva
una copia local; eventos de worker descargados deben almacenarse como ya
sincronizados.

| Cloud | Klinip One | Tipo/nullability y formato | Semantica | Compatibilidad / accion |
|---|---|---|---|---|
| `id` + `public_id` | `id` | interno + opaco vs opaco / no | identidad ledger | B; definir si One conserva tambien server event ID |
| `reminder_id` | `reminderId` | FK integer vs string / no | agregado | B |
| `occurrence_id` | `occurrenceId` | Cloud nullable; One requerido | target por scope | E: One debe permitir null para scope reminder; definir system |
| `delivery_id` | `deliveryId` | nullable; requerido para delivery | target delivery | A, pero One solo usa assert de tipo/scope |
| `health_profile_id` | `healthProfileId` | FK integer vs string / no | aislamiento | B |
| `actor_kind` | `actorKind` | user/device/worker / no | origen | A |
| actor user/device IDs | mismos conceptos | nullable por actor | identidad | D: One debe validar combinacion de actor |
| `event_scope` | `scope` | mismos cuatro strings | agregado afectado | A |
| `event_type` | `type` | Cloud `delivered`; One `deliveryDelivered` | accion tipada | F: codec wire separado del nombre Dart/local |
| `client_event_id` | `clientEventId` | string / cliente no nulo | clave de retry | E: constraint local por target+actor+client ID |
| `request_fingerprint` | `requestFingerprint` | Cloud SHA-256 largo 64; One string libre | detecta payload distinto | D: normalizacion y validacion compartidas |
| `expected_version` | `expectedVersion` | integer / si | control optimista | A |
| `resulting_state` | `resultingState` | string / no | resultado autoritativo | D: validar contra scope |
| `resulting_version` | `resultingVersion` | integer positivo / no | version autoritativa | A |
| timestamps cliente/servidor | mismos campos | UTC / si/no | servidor manda | A con codec |
| `error_code` | `errorCode` | allowlist / si | rechazo saneado | D: One no aplica allowlist |
| `metadata_json` | `metadata` | JSON allowlist / no | datos tecnicos | D: One delega validacion al caller |
| no existe | `synced_at` SQLite | epoch UTC / si | estado de outbox local | B: no serializar |
| unique por client event | solo PK `id` local | target + actor + client ID | idempotencia | E: mismo client ID con distinto ID hoy duplica |

### 6. ReminderDraft (solo local)

No es una entidad Cloud ni un recordatorio activo. Solo su comando estructurado se
sincroniza a Cloud despues de confirmacion.

| Campo One | Tipo/nullability y formato | Semantica | Compatibilidad / accion |
|---|---|---|---|
| `localDraftId` | string opaco / no | identidad local | C: ADR-005 dice UUIDv7, implementacion no; alinear texto o codigo |
| `healthProfileId` | string / no | aislamiento | A |
| `idempotencyKey` | string / no | retry estable | A; nunca registrar en logs |
| `title`, `body` | envelope por campo | contenido local | E: debe usar cipher real antes de produccion |
| fecha/hora/zona/recurrence | estructurados | intencion civil | D: validar IANA y regla completa |
| `targetDeviceId` | string / si | target solicitado | A; Cloud resuelve grant/preferred |
| `state` | cuatro estados locales | lifecycle pre-Cloud | B: no enviar como Reminder state |
| `cloudReminderId` | string / si | mapping tras aceptacion | A |
| timestamps | UTC | lifecycle | A |
| rejection reason | ausente | rechazo recuperable | D: agregar codigo saneado antes del connector |
| expiry/attention | no modelado | draft vencido o corregible | F: obligatorio antes de crear offline en UI |

## Estados, acciones y terminalidad

| Concepto | Clasificacion correcta |
|---|---|
| `active`, `awaiting_device` | estados persistentes de Reminder |
| `scheduled`, `due`, `snoozed` | estados persistentes reconciliables de Occurrence |
| `completed`, `dismissed`, `cancelled`, `expired`, `failed` | terminales de Occurrence segun transicion |
| `queued`, `delivered`, `announced` | estados persistentes no terminales de Delivery |
| `superseded`, `failed`, `expired`, `cancelled` | estados terminales de Delivery |
| `updated`, `materialized`, `completed`, `snoozed`, etc. | tipos de evento/accion, no una cuarta maquina de estados |
| `pending` | no es estado canonico; solo concepto de outbox/draft |
| `revoked` | no es estado canonico; se representa con `revoked_at` y cancelacion/supersession |
| `repeated` | accion de UX; no estado ni evento persistente de Cloud |
| `heard`, `acknowledged` | exclusivos de Family Messaging; prohibidos en reminders |

`completed` y `dismissed` son acciones globales sobre la occurrence. `delivered`
y `announced` solo afectan el delivery del dispositivo. Un TTS interrumpido no
crea `announced`.

## Cifrado: contrato pendiente obligatorio

### Estado real

- Cloud solo tiene columnas de persistencia; no hay gestion de claves ni servicio
  criptografico implementado.
- Klinip One tiene `ReminderPayloadCipher`, pero la unica implementacion es
  `NoOpReminderPayloadCipher`: base64 con plaintext y fingerprint AAD. No ofrece
  confidencialidad ni autenticidad y no puede usarse en produccion.
- El contrato HTTP propuesto entrega `title` y `body` en claro al dispositivo
  autenticado. Por tanto, el cifrado Cloud y el cifrado local son fronteras de
  reposo independientes, no un ciphertext end-to-end reutilizable.

### Decision Cloud congelada pre-merge

Cloud persiste un unico envelope para el JSON `{title, body}` con:

- `content_ciphertext` no vacio;
- `content_nonce` unico y no vacio;
- `content_key_version` positiva;
- `content_algorithm_version` positiva;
- `tag`, o declaracion explicita de que va anexado al ciphertext;
- AAD futura canonica: algorithm version, profile public ID y reminder public ID.

Cloud cifra/descifra con claves Cloud. Klinip One cifra/descifra con una clave de
datos local protegida por Android Keystore. No se afirma que sea hardware-backed
sin attestation. La rotacion conserva versiones anteriores hasta verificar la
reencriptacion.

Si One no puede descifrar un payload, no lo anuncia, no crea `announced`, no lo
borra silenciosamente y registra un codigo tipado saneado para soporte. Debe
quedar en cuarentena/reconciliacion sin incluir ciphertext, plaintext o excepcion
libre en logs.

## SQLite y PostgreSQL

| Diferencia | Evaluacion |
|---|---|
| Cloud aplica FK RESTRICT; SQLite local no aplica FKs | B: intencional para cache fuera de orden, pero el connector debe validar parentesco antes del commit |
| Cloud usa PK numerica + public ID; One usa ID opaco como PK | B: correcto si solo viajan public IDs |
| Cloud es fuente de verdad; SQLite es cache | A |
| One conserva events como tombstones | B: compatible con retencion local, sujeto a limites ADR-004 |
| One elimina terminales por cutoff generico | D: aplicar ventanas por entidad antes de produccion |
| One separa por `healthProfileId` | A, pero toda escritura debe comprobar el perfil autenticado |
| Cloud soporta delivery por device | A |
| One usa `ConflictAlgorithm.replace` | E para occurrence y versiones: puede borrar/cambiar identidad y aceptar snapshots stale |
| One abre SQLite version 1 sin migracion incremental | E: el esquema todavia no esta expuesto; corregirlo ahora evita una migracion inmediata |
| One no persiste cursor de inbox | E: no puede garantizar persistencia de pagina+cursor en una sola transaccion |

La ausencia de FK local no rompe por si sola la reconciliacion. Si la rompe el
uso de REPLACE sobre una constraint logica: una occurrence repetida con otro ID
reemplaza la fila canonica y puede dejar deliveries/events apuntando al ID viejo.

## Estrategia futura exacta de idempotencia y reconciliacion

1. **Mismo Reminder dos veces:** resolver por `public_id` y perfil. Misma version
   y fingerprint produce no-op; version mayor reemplaza en transaccion; version
   menor se ignora. Nunca aceptar el mismo public ID desde otro perfil.
2. **Misma Occurrence dos veces:** resolver primero por public ID y despues por
   `(reminder_id, schedule_version, logical_occurrence_key)`. Si la clave logica
   existe con otro public ID, detener sincronizacion y reconciliar; nunca REPLACE.
3. **Mismo Delivery dos veces:** unique local
   `(occurrence_id, device_id, delivery_revision)`. El mismo public ID/revision es
   no-op; una colision con otro public ID es conflicto de protocolo.
4. **Mismo Event dos veces:** unique local por scope, target, actor device/user y
   `client_event_id`. Mismo fingerprint devuelve la fila existente; fingerprint
   distinto queda como conflicto permanente y no se reintenta.
5. **Reconexion offline:** refrescar config, token/grant y revocacion; descargar
   inbox; validar; persistir items y cursor en una transaccion; solo despues
   drenar outbox en orden causal.
6. **Conflicto de version:** Cloud gana. One aplica snapshot autoritativo en una
   transaccion y marca la accion local como rechazada/requiere atencion; no
   incrementa versiones por su cuenta para forzar aceptacion.
7. **Persistencia fallida:** no avanzar cursor, no crear `delivered`, no borrar el
   payload y reintentar con backoff.
8. **Revocacion:** invalidar capacidad de actuar antes de drenar outbox y limpiar
   datos del device segun politica; no reasignar silenciosamente.

## Hallazgos priorizados

### E - bloqueantes antes de merge

1. `ReminderEvent.occurrenceId` requerido en One pero nullable por scope en Cloud.
2. `ReminderDelivery.occurrenceId` nullable en One pero obligatorio en Cloud.
3. One no tiene constraints por client event ni por delivery logico.
4. El upsert de occurrence con REPLACE cambia el ID canonico ante colision.
5. One no tiene cursor de inbox ni API para confirmar pagina+cursor atomicos.

### D - ajustes menores de codigo

- validacion local IANA, recurrence, fingerprints, actor/target y resulting state;
- rechazo de snapshots stale por version;
- codigo saneado de rechazo en drafts;
- retencion local diferenciada por entidad.

### C - ajustes documentales

- decidir ID opaco vs UUIDv7; hoy no existe garantia UUID comun;
- documentar `occurrence_version` como revision esperada;
- aclarar que `delivery_attempts` cuenta eventos accepted, no retries HTTP;
- actualizar documentos `PROPOSED` cuando las ramas se fusionen, no antes;
- documentar la frontera de descifrado Cloud -> TLS -> cifrado local.

### F - obligatorio antes del connector

- codec JSON canonico y fixtures compartidos Cloud/One;
- mapping del event ID servidor;
- comportamiento de payload no descifrable;
- codec explicito snake_case/camelCase para todos los enums;
- tests cruzados con los mismos JSON para todos los estados y DST.

## Contraste con la revision paralela de Klinip One

Durante esta auditoria aparecio, sin intervencion de este worktree, el documento
local no rastreado
`docs/integration/reminders_v0.7.7_local_cloud_compatibility_review.md`. Coincide
en que Cloud y One cifran en fronteras de reposo independientes, y detecta la
nullability de `ReminderEvent.occurrenceId` y la ausencia del cursor.

Se verificaron cuatro discrepancias de ese borrador contra el codigo real:

1. Afirma que SQLite replica el unique de delivery. El `CREATE TABLE
   reminder_deliveries` local, lineas 142-158, no contiene `UNIQUE`; Cloud si
   define `(occurrence_id, device_id, delivery_revision)`.
2. Considera compatible el unique de occurrence, pero el test SQLite lineas
   22-52 exige que una colision con otro ID elimine la fila anterior mediante
   REPLACE. Eso cambia identidad y puede dejar referencias locales huerfanas.
3. Delega idempotencia de eventos a un ID estable futuro, pero `appendEvent`,
   lineas 477-492, consulta solo `event.id`; no existe algoritmo canonico ni
   constraint para `(target, actor, client_event_id)`.
4. La independencia de cifrado evita interoperar ciphertexts. PR #30 resolvio
   ademas su riesgo interno mediante un solo payload cifrado y un nonce.

Por esas diferencias, este informe no adopta la recomendacion de fusionar PR #11
sin ajustes. Cloud puede avanzar primero despues de validacion y CI.

## Orden recomendado

1. Validar y fusionar PR #30 sin activar endpoints ni escrituras.
2. Corregir PR #11: nullability, constraints, cursor y upserts no destructivos.
3. Consumir en Klinip One los fixtures JSON canonicos de contrato y comprobar
   round-trip byte/valor equivalente.
4. Repetir esta auditoria de los puntos E.
5. Fusionar PR #30 primero, porque Cloud define la autoridad y el contrato.
6. Rebasar/confirmar PR #11 contra el contrato final y fusionarlo despues.
7. Mantener cerrado el inicio de endpoints, connector y scheduler hasta completar
   los pasos anteriores.

## Evidencia revisada

Cloud:

- `backend/app/models.py`;
- `backend/alembic/versions/20260802_000001_add_reminder_domain.py`;
- `backend/tests/test_reminder_domain.py`;
- `backend/tests/test_reminder_migration.py`;
- ADR-003, ADR-004 y ADR-005;
- contrato Cloud/device;
- schema and migrations;
- scheduler worker;
- cross-repo execution plan;
- PR #30 y sus cuatro checks verdes.

Klinip One, solo lectura:

- ADR-046;
- los seis modelos solicitados;
- estados, recurrence y cipher envelope;
- `ReminderRepository` y `SqliteReminderRepository`;
- cipher abstraction, no-op, fixtures y tests;
- PR #11 y sus dos checks verdes.

## Limites de esta auditoria

- Cero cambios en Klinip One.
- Cero cambios de codigo Cloud.
- Cero migraciones nuevas.
- Cero endpoints, scheduler, connector, TTS o Android scheduling.
- Cero deploy, Railway o PostgreSQL productivo.
- PR #30 permanece Draft, abierto y sin merge.
- PR #11 permanece Draft, abierto y sin merge.
