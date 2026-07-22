# Klinip Cloud Integration v0.7.2 - Device Identity and Pairing

Fecha: 2026-07-22

Repositorio: `Diegogigi/klinip`

Rama: `feature/v0.7.2-device-identity-pairing`

Base: `c6f0d5fd7f8ac0893534191cbede7c3a93ae8aef`

## 1. Objetivo y contexto

Esta etapa crea una frontera cloud minima para identificar, vincular, autorizar
y revocar dispositivos Klinip One. No conecta la aplicacion Flutter ni habilita
mensajes o funciones clinicas.

La foundation parte del cierre productivo de v0.7.1d. El web y el worker no se
modifican operativamente; Railway y PostgreSQL de produccion permanecen sin
cambios durante la implementacion y validacion local.

## 2. Arquitectura y ADR

La decision se registra en
`docs/decisions/ADR-001-device-identity-pairing-revocable-credentials.md`.

El flujo autorizado es:

1. Un usuario humano autorizado selecciona un `HealthProfile` y crea un pairing.
2. El servidor devuelve una vez un codigo temporal y conserva solo su HMAC.
3. El dispositivo reclama el codigo y recibe identidad, grant y credenciales
   propias en una unica transaccion.
4. El dispositivo usa access tokens cortos y scopes limitados.
5. El refresh rota en una familia independiente de sesiones humanas.
6. Un administrador autorizado puede revocar inmediatamente el dispositivo.

La relacion MVP es `Device -> DeviceGrant -> HealthProfile`. No se agrega
`Household` porque esta etapa no demuestra una necesidad funcional para esa
entidad.

## 3. Modelos

- `Device`: identidad publica, label, plataforma, tipo, versiones, capabilities
  saneadas, estado, version de token, ultimo contacto y revocacion.
- `DevicePairing`: HMAC del codigo, actor humano, perfil, scopes, expiracion,
  intentos, estado y consumo unico.
- `DeviceCredential`: HMAC de refresh, familia, rotacion, expiracion, reuse y
  revocacion. No almacena access tokens.
- `DeviceGrant`: perfil, scopes aprobados, protocolo, otorgante y revocacion.

Un indice parcial unico impide dos grants activos equivalentes para el mismo
dispositivo y perfil. Las foreign keys usan reglas de borrado explicitas y no
hay cascadas destructivas.

## 4. Scopes y permisos humanos

La allowlist inicial contiene exclusivamente:

- `device:read_config`;
- `profile:read_basic`;
- `device:refresh`;
- `device:heartbeat`.

Owner y admin pueden administrar dispositivos. Un caregiver necesita el nuevo
permiso explicito `manage_devices`; no lo recibe por defecto. Viewer nunca puede
crear, consultar administrativamente ni revocar dispositivos, incluso si un
payload intenta incluir el permiso. Los scopes provienen del pairing humano y
nunca de las capabilities declaradas por el dispositivo.

## 5. Pairing y claim

El codigo tiene ocho caracteres criptograficamente aleatorios, formato `4-4`,
alfabeto sin caracteres ambiguos, normalizacion case-insensitive, vigencia entre
60 y 900 segundos y cinco intentos por pairing. Se devuelve solo en el `POST` de
creacion y no aparece en consultas, modelos de salida, auditoria ni logs.

`claim` valida estado, expiracion, protocolo y capabilities. Usa lock de fila en
PostgreSQL, transicion condicional `pending -> claimed`, constraints y un solo
commit para Device, Grant, Credential y Pairing. Solo un competidor consume el
codigo; los demas reciben un error seguro sin crear filas parciales.

El rate limit en memoria separa IP y endpoint. Para `claim` agrega el HMAC del
codigo como sujeto, de modo que limita tambien cada pairing sin conservar el
secreto en claro.

## 6. Frontera de autenticacion

La autenticacion humana y la de dispositivo son implementaciones separadas:

- principal humano: `User` y dependency humana existente;
- principal device: `DevicePrincipal` y dependency exclusiva;
- access humano: `type=access`, `token_type=human_access`;
- access device: `type=device_access`, `token_type=device_access`;
- firma device: clave derivada por HMAC con dominio
  `klinip-device-access-v1`;
- refresh humano: tabla `RefreshToken` y hash humano existentes;
- refresh device: tabla `DeviceCredential` y HMAC con dominio
  `klinip-device-refresh-v1`.

La clave device no es la clave humana. Un token device no puede validarse con la
firma humana y un token humano no puede validarse con la firma device. Ademas,
ambas dependencias exigen el tipo esperado. La compatibilidad temporal solo
permite tokens humanos historicos sin `token_type`; nunca permite un token
device, cuya firma y tipo son distintos.

Pruebas cruzadas verifican que:

- `/me`, listado, detalle y pairing humanos rechazan access tokens device;
- config y heartbeat device rechazan access tokens humanos;
- refresh device rechaza refresh tokens humanos;
- refresh humano rechaza refresh tokens device.

## 7. Claims y vigencias

El access token device dura 15 minutos e incluye solo `sub`, `type`,
`token_type`, `device_id`, `profile_id`, `scopes`, `token_version`,
`protocol_version`, `credential_id`, `iat`, `exp` y `jti`.

No incluye email, nombre, roles humanos, datos clinicos, refresh token ni familia
interna. El refresh token aleatorio dura como maximo 30 dias y solo su HMAC se
persiste.

## 8. Refresh, reuse y revocacion

Cada refresh valido crea una credencial sucesora, marca la anterior como rotada
y conserva la familia. Reutilizar una credencial rotada:

- marca `reuse_detected_at`;
- revoca toda la familia activa;
- incrementa `Device.token_version`;
- invalida access tokens emitidos antes del evento;
- registra `device_refresh_reuse_detected`.

Revocar un dispositivo marca su estado, fecha y actor; incrementa la version;
revoca grants y credenciales; y bloquea de inmediato config, heartbeat, refresh
y access tokens aun no expirados. La operacion es idempotente y no borra la
identidad.

## 9. Protocolo y capabilities

La unica version admitida es `protocol_version=1`, validada en pairing, claim,
token, config y heartbeat. Una version incompatible no crea un Device parcial.

Capabilities permitidas: `voice`, `living_presence`, `local_asr`,
`place_profile_local` y `family_connector_foundation`. Son informativas, tienen
limites de cantidad y longitud, y nunca se convierten en permisos.

## 10. Privacidad y auditoria

No se sincronizan audio, video, imagenes, transcripciones, conversaciones,
movimiento, ubicacion, coordenadas, PlaceProfile ni datos clinicos. Tampoco se
guardan IMEI, numero de serie o MAC.

`AuditLog` registra creacion/cancelacion/expiracion/bloqueo de pairing, claim,
refresh, reuse, revocacion, lectura de config y heartbeat. La metadata contiene
actor, device, profile, resultado y reason code saneado. No contiene codigos,
tokens, hashes, IP ni contenido sensible.

## 11. Endpoints

Humanos:

- `POST /api/v1/device-pairings`;
- `GET /api/v1/device-pairings/{pairing_id}`;
- `DELETE /api/v1/device-pairings/{pairing_id}`;
- `GET /api/v1/devices`;
- `GET /api/v1/devices/{device_id}`;
- `DELETE /api/v1/devices/{device_id}`.

Sin autenticar, limitados al bootstrap:

- `POST /api/v1/devices/claim`;
- `POST /api/v1/device-auth/refresh`.

Con autenticacion device:

- `GET /api/v1/device/config`;
- `POST /api/v1/device/heartbeat`.

OpenAPI usa DTOs separados y no expone `code_hash`, `refresh_token_hash` ni
`token_family_id`.

## 12. Migracion

La revision `20260722_000001`, basada en `20260704_000001`, crea las cuatro
tablas, indices, constraints y foreign keys. No modifica tablas clinicas.

El baseline historico ejecuta `Base.metadata.create_all` con metadata actual.
Por compatibilidad, la revision detecta si una base nueva ya contiene las cuatro
tablas completas y evita recrearlas; rechaza expresamente un esquema parcial.
En una base productiva ubicada en el head anterior, las tablas no existen y la
revision ejecuta el DDL normal.

Validacion local realizada:

- un unico head: `20260722_000001`;
- base SQLite efimera desde cero;
- upgrade a head;
- downgrade a `20260704_000001`;
- segundo upgrade a head;
- presencia final de las cuatro tablas confirmada.

No se ejecuto ninguna migracion sobre PostgreSQL de produccion.

## 13. Pruebas

Se agregaron 25 casos dirigidos que cubren permisos owner/admin/caregiver/viewer,
perfil ajeno, scopes, expiracion y cancelacion, bloqueo, claim unico, rollback,
separacion de firmas y principals, rechazo cruzado de access/refresh tokens,
rotacion, reuse, revocacion, config, heartbeat, capabilities, rate limits,
auditoria, OpenAPI y privacidad.

Resultado local:

- pruebas dirigidas: `25 passed`;
- suite backend completa: `369 passed`, 38 warnings;
- baseline anterior: 344 pruebas;
- frontend Vite: build aprobado en salida temporal;
- Alembic: upgrade/downgrade/upgrade aprobado y un solo head;
- `git diff --check`: requerido antes del commit.

Los warnings son preexistentes de Pydantic, SQLAlchemy y FastAPI; no representan
fallos de v0.7.2.

## 14. Threat model

| Amenaza | Mitigacion | Evidencia o limite |
|---|---|---|
| Codigo robado o replay | corto, temporal, HMAC, one-time | pruebas de expiracion, cancelacion y segundo claim |
| Brute force o enumeracion | entropia, errores seguros, limite IP/codigo | memoria local; requiere contador compartido al escalar |
| Carrera de claim | row lock, update condicional, constraints, commit unico | un solo ganador y rollback sin filas parciales |
| Escalamiento de scopes | allowlist y scopes del pairing | scope desconocido y scope requerido probados |
| Token robado | access corto, estado/version consultados | revocacion invalida tokens activos |
| Refresh reutilizado | rotacion, familia y reuse detection | familia y access tokens quedan revocados |
| Cruce humano/device | firmas, tablas, tipos y principals separados | matriz cruzada de endpoints y refresh aprobada |
| Device comprometido | revocacion independiente | config, heartbeat y refresh rechazados |
| Caregiver o usuario sin acceso | relacion accepted y permiso actual | caregiver/viewer/outsider probados |
| Perfil archivado | perfil activo requerido en auth y claim | acceso rechazado server-side |
| Downgrade de protocolo | igualdad estricta con version 1 | claim y heartbeat incompatibles rechazados |
| Logs sensibles | DTOs y auditoria saneada | ausencia de codigo, access y refresh probada |
| Abuso de heartbeat | scope y limite por IP | no distribuido en esta etapa |

## 15. Limitaciones y proximo paso

El rate limit es correcto para una replica inicial, pero no es distribuido. Una
escala horizontal necesitara Redis o almacenamiento compartido. No existe aun
sincronizacion con dispositivos reales ni canal de mensajes.

No se implementaron mensajes, inbox, acknowledgements, polling, WebSocket, SSE,
medicamentos, citas, documentos, IA clinica, ubicacion ni cambios en Flutter.
Klinip One no fue modificado.

El proximo paso requiere revision y autorizacion explicita para fusionar y
desplegar Device Identity. Mensajeria permanece fuera de alcance.
