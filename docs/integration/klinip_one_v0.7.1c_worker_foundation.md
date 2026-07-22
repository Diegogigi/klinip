# Klinip Cloud Integration v0.7.1c - Production Worker Foundation

Fecha: 2026-07-22

Repositorio: `Diegogigi/klinip`

Rama: `chore/v0.7.1-railway-ci-foundation`

## 1. Objetivo

Preparar el proceso `python -m app.worker` para ejecutarse como servicio
independiente, sin crear todavia el servicio remoto. La etapa agrega control de
concurrencia, validacion de arranque, parada por senales, logs saneados y pruebas
deterministas.

## 2. Estado inicial

Railway contiene solamente los servicios `klinip` y `Postgres`. El proceso web
fuerza `ENABLE_EMBEDDED_SCHEDULER=false` y no existe un worker separado. Por lo
tanto, los jobs periodicos no estan confirmados como activos en produccion.

La rama parte de `8e7f376141f5d10704f6adcdde07b8a585ea01b1` y extiende el
PR #1, que permanece en borrador y sin merge.

## 3. Problema detectado

Los seis jobs registrados podian ejecutarse simultaneamente si coexistian dos
replicas, un despliegue superpuesto, un worker y el scheduler embebido, o dos
servicios conectados a la misma base. La unicidad de
`PushNotificationLog.tag` no resolvia esa carrera: el envio externo ocurre
antes de insertar el registro y dos procesos podian enviar a la vez.

Tambien se detectaron rutas donde un fallo de email o push podia quedar marcado
como envio exitoso. Se corrigio exclusivamente esa semantica de ejecucion; no se
cambiaron reglas clinicas ni criterios de elegibilidad.

## 4. Arquitectura objetivo

### Servicio web

- FastAPI/Uvicorn atiende HTTP.
- `ENABLE_EMBEDDED_SCHEDULER=false`.
- No ejecuta jobs periodicos.
- Conserva su dominio y health actuales.

### Servicio worker

- Usa el mismo repositorio y backend.
- Ejecuta `python -m app.worker` desde el entorno virtual de Nixpacks.
- Comparte PostgreSQL con el web.
- No abre puerto ni dominio publico.
- Inicia con una replica.
- Rechaza el arranque en produccion si la base no es PostgreSQL o si el
  scheduler embebido esta habilitado.

## 5. Inventario de jobs

Todos los jobs existen, estan registrados y dependen del worker cuando el
scheduler web esta desactivado. El orden es fijo.

| Job | Funcion y frecuencia | Datos afectados | Canal externo | Idempotencia previa | Lock | Pruebas |
|---|---|---|---|---|---|---|
| `send_appointment_reminders` | Cada ciclo, citas dentro de ventana | citas y log de envio | push, email | tag unico posterior al envio | advisory por job | runtime, lock y suite existente |
| `send_medication_reminders` | Cada ciclo, dosis dentro de ventana | medicamentos y log de envio | push, email | tag unico posterior al envio | advisory por job | runtime, proveedor y suite existente |
| `send_refill_alerts` | Cada ciclo, stock bajo umbral | medicamentos y log de envio | push, email familiar | tag y `refill_last_notified_at` | advisory por job | runtime, proveedor y suite existente |
| `send_note_reminders` | Cada ciclo, notas vencidas | `ProfileNote.reminder_sent` | push | bandera posterior al envio | advisory por job | runtime y fallo de push |
| `refresh_profile_ai` | Cada ciclo, perfiles marcados dirty | resumen/contexto de perfil | OpenAI cuando corresponde | bandera dirty y commit por perfil | advisory por job | runtime y retry controlado |
| `refresh_family_ai` | Cada ciclo, familias marcadas dirty | resumen/contexto familiar | OpenAI cuando corresponde | bandera dirty y commit por usuario | advisory por job | runtime y retry controlado |

No se encontraron jobs registrados de limpieza de tokens, sesiones o
notificaciones. La poda de logs de push se ejecuta dentro del job de citas, no
como job independiente.

## 6. Riesgo si el worker no existe

- Recordatorios de citas, medicamentos y notas pueden no enviarse.
- Alertas de reposicion pueden quedar pendientes.
- Contextos de IA de perfil y familia pueden permanecer desactualizados.
- El web continua operativo, pero sin garantia de automatizaciones periodicas.

## 7. Riesgo de duplicacion

Los seis jobs eran capaces de duplicarse entre procesos. Los cuatro jobs de
notificacion tienen mayor impacto porque producen efectos externos. Los dos
jobs de IA pueden duplicar costo, calculo y escrituras.

Los jobs con efectos externos se declaran `retry_safe=false`: no se reintentan
automaticamente dentro del mismo ciclo despues de un fallo posiblemente
parcial. Los refresh de IA conservan reintentos limitados porque escriben por
entidad y mantienen su marca dirty ante fallo.

## 8. Mecanismo de lock

`JobLockManager` calcula una clave signed int64 determinista con SHA-256 sobre
un namespace versionado y el nombre del job. En PostgreSQL obtiene
`pg_try_advisory_lock` sobre una conexion dedicada y no espera si otro proceso
ya posee el lock.

El lock se mantiene durante toda la ejecucion y sus reintentos, se libera con
`pg_advisory_unlock` en `finally` y la conexion siempre se cierra. Si falla la
liberacion, la conexion se invalida antes de cerrarla. El scheduler embebido y
el worker usan el mismo mecanismo, por lo que tambien compiten entre si.

SQLite usa locks no bloqueantes en memoria del proceso para tests y desarrollo.
Este fallback evita romper la suite, pero no coordina procesos SQLite distintos
y no se considera apto para produccion.

### Limite de la garantia

El advisory lock impide ejecuciones simultaneas del mismo job mientras el
proceso conserva la conexion. No garantiza exactly-once si el proceso muere
despues de un envio externo y antes de registrar el tag. Cerrar esa ventana
requiere outbox transaccional o claves de idempotencia aceptadas por cada
proveedor; queda fuera de v0.7.1c.

La proteccion se aplica a las dos rutas operativas soportadas: worker dedicado
y scheduler embebido. Una llamada manual directa a una funcion privada
`_job_*` evita el orquestador y no debe usarse en produccion; cualquier
ejecucion manual futura debe entrar por el registro protegido.

## 9. Ciclo de ejecucion

- Un `threading.Lock` local impide ciclos superpuestos dentro de una replica.
- Cada ciclo respeta `WORKER_CYCLE_BUDGET_SECONDS`.
- Cada handler recibe un deadline y devuelve `timed_out` cooperativamente.
- Un fallo se aisla por job y los jobs siguientes continuan.
- La pausa usa `Event.wait`, por lo que no existe busy loop.
- Los handlers existentes cierran sus sesiones DB en `finally`.

## 10. Retries y timeout

`WORKER_JOB_TIMEOUT_SECONDS` y overrides por job limitan el tiempo cooperativo.
No se interrumpe un thread dentro de una operacion DB o de proveedor porque eso
podria dejar estado inconsistente. Un handler que excede el limite se registra
como `job_timed_out` al retornar.

`WORKER_JOB_RETRIES` solo aplica a jobs declarados seguros para retry. Los jobs
de push y email no se repiten automaticamente tras una excepcion parcial.

## 11. Parada segura

SIGTERM y SIGINT activan un `Event` de cierre. El worker no inicia nuevos jobs
ni ciclos, espera que el handler actual retorne, libera su lock y emite
`worker_stopped`. La espera entre ciclos se interrumpe inmediatamente.

## 12. Logging y health

Eventos disponibles:

- `worker_started`, `cycle_started`, `job_started`;
- `job_skipped_lock`, `job_succeeded`, `job_failed`, `job_timed_out`;
- `cycle_completed`, `worker_stopping`, `worker_stopped`.

Los logs solo contienen nombres de jobs, tiempos, intentos, clases de error y
contadores agregados permitidos. No contienen URLs DB, credenciales,
destinatarios, nombres, contenido clinico, tokens ni coordenadas.

La primera version no agrega endpoint ni migracion de health. Railway mostrara
el proceso running, ciclos en logs, exit code y reinicios. Esta observabilidad
es suficiente para el primer despliegue, pero no sustituye un heartbeat externo.

## 13. Pruebas

La validacion dirigida usa jobs falsos, reloj inyectado, SQLite y proveedores
mock. Cubre orden, fallos aislados, timeout, retries, presupuesto, ciclos,
senales, locks, cierre de conexiones, logs saneados, configuracion, import del
modulo y ausencia de llamadas reales a email, push y OpenAI.

Las pruebas del worker permanecen dentro de `Backend tests`; no se agregan
checks ni cambios al ruleset de `main`.

## 14. Configuracion Railway propuesta

No ejecutar todavia.

- Project: `klinip`.
- Environment: `production`.
- Source: repositorio GitHub `Diegogigi/klinip`.
- Branch: `main`, solo despues del merge autorizado.
- Root directory: raiz del repositorio, sin override.
- Builder: Nixpacks existente.
- Start command exacto:
  `cd backend && ENABLE_EMBEDDED_SCHEDULER=false venv/bin/python -m app.worker`
- Public domain: ninguno.
- HTTP health check: ninguno.
- Restart policy: `ON_FAILURE`.
- Replicas iniciales: `1`.
- Servicio web: conservar `ENABLE_EMBEDDED_SCHEDULER=false`.

## 15. Variables por nombre

Reutilizar referencias de variables, sin copiar valores:

- criticas: `DATABASE_URL`, `SECRET_KEY`;
- worker: `WORKER_INTERVAL_SECONDS`, `WORKER_CYCLE_BUDGET_SECONDS`,
  `WORKER_JOB_RETRIES`, `WORKER_JOB_TIMEOUT_SECONDS`;
- lotes: `APPOINTMENT_REMINDER_BATCH_SIZE`,
  `APPOINTMENT_REMINDER_APPOINTMENT_LIMIT`,
  `MEDICATION_REMINDER_BATCH_SIZE`,
  `MEDICATION_REMINDER_MEDICATION_LIMIT`, `REFILL_ALERT_BATCH_SIZE`,
  `FAMILY_AI_REFRESH_BATCH_SIZE`, `SCHEDULE_GRACE_SECONDS`;
- canales: variables `RESEND_*`, `MAIL_*`, `VAPID_*`, `OPENAI_*` ya usadas
  por el backend;
- control: `ENABLE_EMBEDDED_SCHEDULER=false`.

No se cambian valores de produccion durante esta fase.

## 16. Validacion remota pendiente

Despues de autorizacion explicita:

1. crear solo el servicio worker con una replica;
2. confirmar arranque y lista de seis jobs;
3. confirmar ciclos sin `startup_failed` ni reinicios repetidos;
4. observar adquisicion y liberacion de locks;
5. comprobar que el web sigue respondiendo `/health`;
6. validar un caso controlado de cada tipo sin duplicar efectos;
7. detenerse ante errores de proveedor o base.

## 17. Deployment rojo historico

El deployment rojo visible en Railway sigue clasificado como historico no
bloqueante porque los endpoints publicos sirven HTTP 200 desde un deployment
anterior. No se ejecuto redeploy ni se modifico Railway.

## 18. Rotacion PostgreSQL pendiente

La rotacion precautoria recomendada en v0.7.1 continua pendiente. Esta etapa no
leyo datos, no cambio credenciales y no modifico PostgreSQL remoto.

## 19. Fuera de alcance

No se implementaron Device Identity, pairing, outbox, reglas clinicas, UI,
migraciones, modelos, cambios DNS, hardware ni integracion con Klinip One.

## 20. Criterio de aceptacion

- seis jobs inventariados;
- lock por job y guard de ciclo implementados;
- fallos de proveedor no registrados como exito en las rutas corregidas;
- senales y logs saneados cubiertos;
- suite backend, frontend, migraciones y CI verdes;
- servicio remoto aun inexistente;
- PR #1 permanece en borrador y sin merge.

## 21. Rollback y proximo paso

Rollback futuro:

1. detener o eliminar solamente el servicio worker;
2. no modificar el web;
3. conservar `ENABLE_EMBEDDED_SCHEDULER=false`;
4. conservar PostgreSQL;
5. verificar `/health`;
6. revisar jobs parcialmente ejecutados;
7. no reactivar el scheduler web sin decision explicita.

Proximo paso: revisar este resultado y solicitar autorizacion separada para
crear y validar el servicio worker en Railway.
