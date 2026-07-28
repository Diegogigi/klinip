# ADR-001: Device Identity, Pairing and Revocable Credentials

Fecha: 2026-07-22

Estado: Accepted for implementation on `feature/v0.7.2-device-identity-pairing`

## Contexto

Klinip necesita autorizar dispositivos Klinip One sin entregarles contrasenas,
sesiones ni tokens de usuarios humanos. La primera capacidad cloud se limita a
identidad, pairing, configuracion minima y heartbeat. No habilita mensajeria ni
datos clinicos.

## Decision

### Identidad y frontera de autenticacion

Un `Device` es un principal independiente. Los access tokens humanos y device
usan claves de firma separadas por derivacion HMAC con dominios distintos. El
token device exige simultaneamente `type=device_access` y
`token_type=device_access`; la dependencia humana solo acepta `type=access`.
Las rutas humanas producen un `User` y las rutas device un `DevicePrincipal`.
No existe conversion entre ambos actores.

Klinip One nunca recibe contrasena humana, access/refresh token humano, cookie
de sesion ni API key global compartida.

### Pairing

Un usuario owner/admin, o un caregiver con permiso explicito
`manage_devices`, crea un `DevicePairing` para un `HealthProfile`. El codigo se
genera con aleatoriedad criptografica, usa alfabeto sin caracteres ambiguos,
expira, es one-time y solo se devuelve en la respuesta de creacion. La base
persiste un HMAC del codigo con pepper derivado; nunca el codigo en claro.

Viewer no puede administrar dispositivos. Caregiver no obtiene el permiso por
defecto. El claim toma scopes exclusivamente del pairing aprobado, nunca del
dispositivo.

### Claim e idempotencia

El claim valida estado, expiracion, protocolo y capabilities dentro de una
transaccion. PostgreSQL usa lock de fila y una actualizacion condicional de
`pending` a `claimed`; solo un competidor puede consumir el pairing. Device,
grant y credencial se confirman en el mismo commit. Un fallo revierte todo.
Repetir un codigo consumido devuelve un error seguro y no crea otra identidad.

### Grants y scopes

La relacion MVP es `Device -> DeviceGrant -> HealthProfile`; no se crea
Household. El vocabulario inicial es:

- `device:read_config`;
- `profile:read_basic`;
- `device:refresh`;
- `device:heartbeat`.

Los scopes se normalizan contra allowlist y se verifican server-side. No hay
scopes de mensajes, medicamentos, citas, documentos, escritura familiar ni IA.
Capabilities son informacion declarativa y nunca conceden permisos.

### Tokens

El access token device dura 15 minutos e incluye `sub`, `token_type`, `type`,
`device_id`, `profile_id`, `scopes`, `token_version`, `protocol_version`,
`credential_id`, `iat`, `exp` y `jti`. No incluye identidad humana, contenido
clinico, token de refresh ni familia interna.

El refresh token es aleatorio de alta entropia, dura 30 dias y se persiste como
HMAC. Cada uso rota la credencial dentro de una familia. Reutilizar una
credencial rotada revoca toda la familia e incrementa `Device.token_version`,
invalidando inmediatamente access tokens existentes. No se comparte la tabla
humana `RefreshToken`.

### Revocacion

Revocar no borra el dispositivo. Marca `Device.status=revoked`, incrementa su
version, revoca grants y credenciales, y registra auditoria. Config, heartbeat,
refresh y access tokens se rechazan inmediatamente.

### Protocolo y privacidad

La unica version aceptada es `protocol_version=1`. Un downgrade o version
desconocida se rechaza antes de crear datos parciales. Solo se almacenan label,
plataforma, tipo, version, capabilities saneadas, estado, ultimo contacto,
scopes y perfil vinculado. No se almacenan IMEI, serie, MAC, audio,
transcripciones, ubicacion, imagenes, video, movimiento ni conversaciones.

### Auditoria y rate limiting

Los eventos de pairing, claim, refresh, reuse, revocacion, config y heartbeat
usan `AuditLog` sin codigos, tokens ni hashes. El rate limiting inicial es en
memoria y por IP/endpoint; `claim` agrega el HMAC del codigo como dimension para
aislar intentos por pairing sin almacenar el codigo. Es suficiente para una
replica, pero no distribuido; antes de escalar se requiere Redis u otro contador
compartido.

## Threat model

| Amenaza | Mitigacion | Limite y prueba |
|---|---|---|
| Codigo robado | expiracion corta, one-time, HMAC y claim atomico | quien lo posea dentro de ventana puede reclamar; pruebas de expiracion/reuso |
| Brute force y enumeracion | alta entropia, errores uniformes y rate limit | memoria por replica; pruebas de codigo invalido y limite |
| Replay del codigo | transicion condicional y `claimed_at` | sin idempotencia cross-request; pruebas de claim doble/concurrente |
| Token robado | access corto, scopes y estado consultado | valido hasta expiracion salvo revocacion/version; pruebas de revocacion |
| Refresh reutilizado | rotacion, reuse detection y revocacion familiar | puede cerrar una familia legitima ante carrera; pruebas de reuse/concurrencia |
| Device comprometido | revocacion independiente e inmediata | no borra actividad pasada; pruebas de config/heartbeat rechazados |
| Usuario pierde acceso | autorizacion humana se evalua en cada administracion | grants existentes requieren revocacion explicita futura; pruebas de perfil ajeno |
| Caregiver revocado | relacion accepted y permiso explicito | no existe propagacion de rol al device; pruebas caregiver/viewer |
| Perfil eliminado/archivado | grant y perfil activos requeridos | no hay cascade destructiva; pruebas de autorizacion |
| Carrera en claim | row lock, update condicional, constraints y transaccion | SQLite no replica locks PostgreSQL; prueba determinista de un ganador |
| Escalamiento de scopes | allowlist y scopes tomados del pairing | nuevos scopes requieren cambio de servidor; pruebas de scope desconocido |
| Protocol downgrade | igualdad estricta con version 1 | sin negociacion aun; pruebas de version incompatible |
| Logs sensibles | auditoria saneada y errores por reason code | observabilidad solo agregada; pruebas de ausencia de secretos |
| Abuso heartbeat | scope y rate limit | contador no distribuido; prueba de limitacion |

## Decisiones descartadas

- Reutilizar JWT, refresh token o sesion humana: rompe aislamiento y revocacion.
- API key global: compromete todos los dispositivos y no permite auditoria.
- Guardar codigos/tokens en claro: aumenta impacto de una lectura de base.
- Conceder scopes desde capabilities: permite escalamiento por input cliente.
- Crear Household ahora: no existe necesidad funcional demostrada.
- Redis, outbox, WebSocket o mensajeria: quedan fuera de v0.7.2.

## Consecuencias

Se agregan cuatro tablas y endpoints versionados bajo `/api/v1`. La migracion
no modifica tablas clinicas existentes. La autenticacion humana conserva su
contrato y agrega rechazo explicito de cualquier token device. Railway y Klinip
One no cambian durante esta fase local.
