# Klinip v0.7.7: PR A, dominio y persistencia de recordatorios

- Estado: **IMPLEMENTATION DRAFT — NOT DEPLOYED**
- Rama: `feature/v0.7.7-reminders-domain-migrations`
- Base: merge documental `7642098bb78f3468fe43fbbc6ea2d0b7e2afff48`
- Contrato: [Cloud y dispositivo](../contracts/reminders_cloud_device_contract_v0.7.7.md)
- Esquema: [decisiones de persistencia](../planning/klinip_reminders_v0.7.7_schema_and_migrations.md)

## Alcance implementado

PR A incorpora exclusivamente la base persistente del bounded context
`personal_non_clinical`:

- enums y validadores de dominio;
- modelos SQLAlchemy;
- una migración Alembic aditiva;
- constraints e índices para concurrencia e idempotencia;
- optimistic version sobre definición y settings;
- validación de timezone IANA y recurrencia estructurada v1;
- pruebas de dominio, constraints y upgrade/downgrade.

Tablas:

- `reminder_profile_settings`;
- `reminders`;
- `reminder_occurrences`;
- `reminder_deliveries`;
- `reminder_events`.

Migración:

- revision: `20260802_000001`;
- down revision: `20260727_000001`;
- guardia contra creación parcial;
- upgrade y downgrade verificados en SQLite;
- un único Alembic head.

## Privacidad y cifrado

La definición persiste un único `content_ciphertext` que representa el JSON
`{title, body}`, junto con nonce único, versión de clave y versión de algoritmo.
Constraints impiden envelopes vacíos o versiones no positivas. PR A no incorpora
contenido real, claves, logs de contenido ni una implementación criptográfica.

El envelope protege exclusivamente el reposo Cloud y nunca viaja al dispositivo.
El contrato Device usa `title`/`body` en JSON sobre TLS y Klinip One aplica su
propio cifrado local independiente.

La escritura permanece deshabilitada porque todavía no existen endpoints. La
gestión de claves Cloud y la activación del cifrado aplicativo deben aprobarse
antes de PR B; no se acepta fallback a texto claro para recordatorios.

## Estados canónicos

- Reminder: `active`, `awaiting_device`, `completed`, `cancelled`, `expired`,
  `failed`.
- Occurrence: `scheduled`, `due`, `snoozed`, `completed`, `dismissed`,
  `cancelled`, `expired`, `failed`.
- Delivery: `queued`, `delivered`, `announced`, `superseded`, `failed`,
  `expired`, `cancelled`.

Los estados de Family Messaging `heard` y `acknowledged` no forman parte del
dominio de recordatorios.

## Fuera de alcance

PR A no incorpora:

- endpoints o schemas públicos;
- permisos o scopes activos;
- scheduler o jobs del worker;
- frontend;
- cambios en Klinip One;
- AlarmManager, WorkManager, notificaciones o TTS;
- creación por voz;
- feature flags activos;
- migración de datos existentes;
- cambios en Railway, PostgreSQL productivo o despliegues.

## Validación pendiente

La implementación completa sigue condicionada a PR B-J, aprobación de gestión
de claves, pruebas PostgreSQL concurrentes, revisión de retención y validación
física Huawei/EMUI. Los seis índices históricos detectados por `alembic check`
fuera del dominio `reminders` son deuda previa y no se modifican en PR A.
