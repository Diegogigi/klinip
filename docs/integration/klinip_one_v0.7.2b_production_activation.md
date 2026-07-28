# Klinip Cloud Integration v0.7.2b - Device Identity Production Activation

Fecha: 2026-07-27 (`America/Santiago`)

Repositorio: `Diegogigi/klinip`

## 1. Objetivo

Esta etapa activa en produccion la foundation de Device Identity y valida de
forma controlada pairing, claim, configuracion minima, heartbeat, refresh,
separacion de principals y revocacion. La prueba usa una cuenta y un
`HealthProfile` dedicados, sin registrar credenciales ni datos clinicos en este
documento.

No se inicio mensajeria, no se modifico Klinip One y no se agregaron funciones
clinicas.

## 2. Pull request y merge

La implementacion entro mediante el PR protegido #20:

- PR: `https://github.com/Diegogigi/klinip/pull/20`;
- commit de implementacion:
  `82795e4c9cf706873691b5916fe6df7799699920`;
- metodo: merge commit, para conservar la trazabilidad del cambio;
- merge commit: `2c16553082be801fb14c51e340139556484cc19c`;
- CI run: `29922935306`;
- Backend tests, Frontend build, Migrations check y Secret scan: `success`.

La rama estaba actualizada, el PR era mergeable y no tenia conversaciones ni
revisiones pendientes. No se uso force merge ni push directo a `main`.

## 3. Configuracion y secretos

La revision por nombre confirmo `SECRET_KEY` en produccion. Device access,
device refresh y pairing derivan claves HMAC con dominios independientes:

- `klinip-device-access-v1`;
- `klinip-device-refresh-v1`;
- `klinip-device-pairing-v1`.

La implementacion no exige una variable device nueva. Las vigencias conservan
los limites de 15 minutos para access y 30 dias para refresh. No se mostraron,
rotaron ni modificaron secretos o variables de Railway.

## 4. Migracion productiva

El autodeploy web aplico mediante el flujo normal de arranque:

`20260704_000001 -> 20260722_000001`

La revision crea exclusivamente `devices`, `device_pairings`,
`device_credentials`, `device_grants`, sus indices, constraints y foreign
keys. Los logs confirmaron PostgreSQL con DDL transaccional y la aplicacion
inicio despues del upgrade.

No se ejecuto SQL manual, no se modificaron datos clinicos y no hubo rollback
productivo. Antes del merge se repitio localmente
`upgrade -> downgrade -1 -> upgrade` sobre SQLite efimero, terminando en un
unico head `20260722_000001`.

## 5. Deployments y health

- web deployment: `2e172d06-7238-40d0-a4a8-5466bfdd5071`;
- worker deployment: `d2f0795d-62cf-4f6c-bdad-a25bdce1b5bc`;
- commit de ambos: `2c16553082be801fb14c51e340139556484cc19c`;
- estado final de ambos: `SUCCESS`;
- replicas: una para web y una para worker;
- scheduler embebido del web: desactivado.

`GET https://www.klinip.cl/health` respondio HTTP 200 con `status=ok` en
aproximadamente 554 ms. OpenAPI publico los ocho paths device esperados y no
expuso `code_hash`, `refresh_token_hash` ni `token_family_id`.

## 6. Worker

El worker permanecio activo durante el deploy y la validacion. Se observaron
cinco ciclos consecutivos con seis jobs planificados y seis exitosos por ciclo,
incluidos `refresh_profile_ai` y `refresh_family_ai`.

La ventana no registro `StatementError`, tracebacks, jobs fallidos, timeouts,
crash loops ni ejecuciones duplicadas. No se ejecuto ningun job manualmente y
no se modifico el servicio worker.

## 7. Cuenta y perfil de prueba

Se uso una cuenta de prueba controlada con un unico `HealthProfile` activo,
propio y no archivado. El email, el nombre y el ID interno del perfil se omiten
deliberadamente. No se consultaron medicamentos, citas, documentos ni otros
datos clinicos.

El login no requirio MFA. Las credenciales se ingresaron mediante un dialogo
seguro, se conservaron solo en memoria y el proceso temporal fue cerrado al
terminar.

## 8. Pairing y claim

El pairing solicito solo:

- `device:read_config`;
- `profile:read_basic`;
- `device:refresh`;
- `device:heartbeat`.

Resultados:

- creacion: HTTP 201, protocolo 1 y codigo devuelto una sola vez;
- respuesta sin hashes, familias ni secretos internos;
- codigo alterado: HTTP 400, sin claim parcial;
- human access token sobre config device: HTTP 401;
- claim valido: HTTP 200;
- segundo claim con el mismo codigo: HTTP 409;
- un solo dispositivo, grant y familia de credenciales creados.

El codigo de pairing nunca se imprimio, guardo ni documento.

## 9. Config, heartbeat y refresh

`GET /api/v1/device/config` respondio HTTP 200 y solo incluyo:

- `device_id`;
- `label`;
- `status`;
- `profile_id`;
- `profile_display_name`;
- `scopes`;
- `protocol_version`;
- `server_time`;
- `revoked`.

No incluyo medicamentos, citas, documentos, familia, ubicacion, audio,
conversaciones ni transcripciones. El perfil y los cuatro scopes coincidieron
con el pairing.

El heartbeat respondio HTTP 200 y acepto solo version, protocolo y capability
`local_asr`. No se envio ubicacion, IMEI, MAC, serie ni telemetria sensible.

El refresh device respondio HTTP 200, emitio access y refresh nuevos y marco
rotacion. Los tokens anterior y sucesor no fueron iguales.

## 10. Separacion human/device

La matriz cruzada aprobo completamente:

- human access en endpoint device: HTTP 401;
- device access en `GET /me`: HTTP 401;
- device refresh en refresh humano: HTTP 401;
- human refresh en refresh device: HTTP 401.

Por tanto, los endpoints humanos y device rechazaron el principal opuesto. No
se uso ningun endpoint clinico para esta comprobacion.

## 11. Revocacion y limpieza

El dispositivo logico de prueba, identificado solo por el sufijo saneado
`...4b7802`, fue revocado por API:

- primera revocacion: HTTP 200;
- segunda revocacion idempotente: HTTP 200;
- access device original despues de revocar: HTTP 401;
- access device rotado despues de revocar: HTTP 401;
- heartbeat despues de revocar: HTTP 401;
- refresh device vigente despues de revocar: HTTP 401;
- listado humano: dispositivo presente con estado `revoked`.

La limpieza repitio la revocacion dentro de `finally` y recibio HTTP 200. El
pairing ya estaba consumido, por lo que no quedo ningun codigo pendiente. La
trazabilidad minima del dispositivo revocado se conserva; no hubo borrado
fisico ni SQL manual.

Finalmente se revocaron todas las sesiones de la cuenta de prueba mediante
`DELETE /auth/sessions`:

- cierre global: HTTP 200;
- human access anterior: HTTP 401;
- human refresh anterior: HTTP 401.

Resultado final: cero dispositivos de prueba activos, cero grants activos,
cero credenciales device activas, cero pairings pendientes y cero tokens
humanos de prueba activos.

## 12. Privacidad y observabilidad

Las respuestas device se revisaron contra contenido prohibido y no incluyeron
datos clinicos ni informacion invasiva. Los logs y la auditoria registran
eventos y status codes, no cuerpos de autenticacion.

No se observaron pairing codes, access tokens, refresh tokens, hashes, email de
prueba ni secretos en la ventana revisada. Ningun token o codigo fue escrito a
archivos, historial Git o documentacion.

## 13. Incidentes y limitaciones

No hubo incidentes funcionales, migratorios ni operativos. El campo booleano
`revoked` de config forma parte del DTO y de las pruebas de contrato; no expone
datos adicionales del perfil.

El rate limit device continua en memoria y es apropiado para la replica inicial.
Antes de escalar horizontalmente debe migrarse a un contador compartido. La
validacion de reuse destructivo permanece cubierta por pruebas automatizadas y
no se forzo sobre el unico dispositivo productivo de prueba.

## 14. Alcance preservado

- Railway no recibio cambios manuales ni redeploy manual;
- PostgreSQL no recibio SQL ni migraciones manuales;
- worker no fue modificado;
- Klinip One no fue modificado;
- no se tocaron medicamentos, citas, documentos o IA clinica;
- DeviceMessage, inbox, ack, outbox y mensajeria no fueron iniciados.

## 15. Estado y siguiente etapa

Device Identity v0.7.2b queda activado y validado en produccion con principals
separados, revocacion inmediata y limpieza total de credenciales de prueba.

La siguiente etapa propuesta es v0.7.3 Non-Clinical Family Message Cloud MVP,
iniciada posteriormente en una rama aislada y documentada en
`klinip_one_v0.7.3_non_clinical_family_messages.md`. Este cierre v0.7.2b no fue
modificado operacionalmente y su validacion productiva permanece intacta.
