# Klinip Cloud Integration v0.7.3b - Device Messaging Production Activation

Fecha: 2026-07-28 (`America/Santiago`)

Repositorio: `Diegogigi/klinip`

## 1. Objetivo

Esta etapa fusiona y activa en produccion el MVP de mensajes familiares no
clinicos para dispositivos. La validacion comprueba que descargar el inbox es
una operacion estrictamente de lectura y que `delivered`, `announced`, `heard`
y `acknowledged` solo aparecen mediante eventos device explicitos.

No se modifico Klinip One, no se creo UI, no se implemento polling Flutter y
no se consultaron ni modificaron medicamentos, citas, documentos, audio,
ubicacion o funciones clinicas.

## 2. Pull requests y main

La implementacion entro mediante el PR protegido #22:

- commit de implementacion: `8eb3f872ba6e1f47e73db9c753048f89e8b201bc`;
- metodo: merge commit;
- merge: `2fc440892a674587eccc8affe288c2a9eaf6a272`;
- CI run #35: cuatro checks exitosos.

La activacion detecto dos brechas y ambas se corrigieron por PR, sin push
directo a `main`:

- PR #23 expuso `version` y `delivery_attempts` solo en el detalle humano
  autorizado, para obtener evidencia sin SQL manual. Merge:
  `5ce7a1afb75482ddef0c46d2b301205d53d13332`; CI run #37 exitoso.
- PR #24 corrigio el listado PostgreSQL. Merge:
  `182bfb0d14b7f0f1ae1bb527eb3671a99270a8d8`; CI run #39 exitoso.

El HEAD productivo y `main` al cerrar la validacion funcional fue
`182bfb0d14b7f0f1ae1bb527eb3671a99270a8d8`.

## 3. Deployments y migracion

El merge del PR #22 genero autodeploys exitosos:

- web: `c6c6dac1-e0fb-43bb-871a-d1f3a6d5ba87`;
- worker: `ea59581b-2792-4b74-949e-1e0baac0bb6f`.

Los logs de web confirmaron la aplicacion normal de Alembic
`20260722_000001 -> 20260727_000001`, seguida por inicio correcto de Uvicorn.
La revision crea solo `device_messages`, `device_message_recipients`,
`device_message_events`, indices, foreign keys y constraints. No hubo data
migration, SQL manual, rollback productivo ni mutacion de tablas clinicas.

Los autodeploys finales, correspondientes al fix PostgreSQL y al commit
`182bfb0d`, fueron:

- web: `a30d47b0-39be-4e2b-b329-cb6b2bcabea2`;
- worker: `943d8f6e-2e77-4f03-8e96-6b426c6e8296`.

Ambos terminaron `SUCCESS` con una replica. No se ejecuto redeploy manual, no
se cambiaron variables Railway y PostgreSQL no recibio SQL manual. El head de
Alembic permanece unico en `20260727_000001`.

## 4. Health y worker

`GET https://www.klinip.cl/health` respondio HTTP 200 con `status=ok` antes y
despues de la prueba. La web mantuvo el scheduler embebido desactivado.

En la ventana final, el worker completo cinco ciclos normales. Se observo
`refresh_profile_ai` activo y no se registraron `job_failed`, `StatementError`,
tracebacks, crash loops ni indicadores de ejecucion duplicada. El worker no
fue modificado ni se ejecutaron jobs manualmente.

## 5. Cuenta, perfil y devices de prueba

Se uso la cuenta controlada ya autorizada en v0.7.2b y su perfil de activacion
previo. Correo, nombre e IDs internos se omiten. La autoridad owner/admin se
verifico mediante la aceptacion server-side del pairing.

Se crearon tres devices logicos, sin hardware ni datos personales:

- principal: scopes base, `messages:read` y `messages:ack`;
- lectura limitada: scopes base y `messages:read`;
- base: sin scopes de mensajeria.

Los tres usaron protocolo 1, labels de prueba y ninguna capability de hardware.
Todos quedaron revocados al terminar.

## 6. Creacion e idempotencia

Se creo un mensaje claramente no clinico con un recipient, acknowledgement
requerido y expiracion controlada. Resultado:

- HTTP 201;
- message ID saneado: `...d342d1`;
- recipient count: 1;
- estado inicial: `queued`;
- sin hashes, tokens ni metadata interna en la respuesta.

Repetir el request con la misma clave devolvio HTTP 201, el mismo message ID y
`reused_idempotency_result=true`. Reusar la clave con otro payload devolvio
HTTP 409 y no creo un segundo mensaje ni recipient. La clave no se registro en
este documento ni aparecio en logs.

## 7. Evidencia principal: inbox de solo lectura

El recipient principal se consulto mediante el detalle humano autorizado antes
del inbox y despues de cada una de tres descargas. Esta es la comparacion
saneada completa:

| Momento | current_state | version | delivery_attempts | eventos |
| --- | --- | ---: | ---: | ---: |
| Antes del inbox | `queued` | 1 | 0 | 0 |
| Despues de lectura 1 | `queued` | 1 | 0 | 0 |
| Despues de lectura 2 | `queued` | 1 | 0 | 0 |
| Despues de lectura 3 | `queued` | 1 | 0 | 0 |

Por tanto, descargar el inbox no creo `DeviceMessageEvent`, no incremento
intentos, no cambio la version y no implico `delivered`, `announced`, `heard`
ni `acknowledged`.

## 8. Cursor

La paginacion con limite 1 devolvio dos paginas sin perdida ni duplicacion. El
mismo cursor produjo la misma segunda pagina. Un cursor alterado y el cursor
usado por otro device fueron rechazados con HTTP 400.

El cursor completo no se incluye. Cuatro URLs de acceso contenian cursors
opacos firmados de dos segmentos; no eran JWT y no contenian tokens de acceso
o refresh.

## 9. Eventos explicitos

Solo despues de las lecturas se enviaron eventos device. Los resultados
persistidos fueron:

| Evento explicito | HTTP | Estado | version | intentos | eventos |
| --- | ---: | --- | ---: | ---: | ---: |
| `delivered` | 200 | `delivered` | 2 | 1 | 1 |
| `announced` | 200 | `announced` | 3 | 1 | 2 |
| `heard` | 200 | `heard` | 4 | 1 | 3 |
| `acknowledged` | 200 | `acknowledged` | 5 | 1 | 4 |

Cada evento se repitio con el mismo `client_event_id`: devolvio HTTP 200 con
`duplicate=true`, sin segunda fila, sin otra version y sin otro incremento de
intentos. Reusar un `client_event_id` con payload distinto devolvio HTTP 409.

Descargar el inbox en `announced` y `heard` conservo esos estados. No hubo
avance automatico. Despues de `acknowledged`, los intentos de `delivered`,
`announced` y `failed` devolvieron HTTP 409; el estado continuo terminal con
version 5, un intento y cuatro eventos.

## 10. Orden, principals y scopes

Sobre un mensaje nuevo en `queued`, `acknowledged`, `heard`, `announced` y
`failed` fuera de orden fueron rechazados con HTTP 409. El recipient continuo
`queued`, version 1 y cero eventos.

La separacion de principals aprobo:

- human access contra inbox device: HTTP 401;
- device access contra listado humano: HTTP 401.

La separacion de scopes aprobo:

- device sin `messages:ack` contra `acknowledged`: HTTP 403;
- device sin `messages:read` contra inbox: HTTP 403.

## 11. Revocacion y expiracion

La revocacion humana de un mensaje no terminal respondio HTTP 200. Repetirla
respondio HTTP 200, el recipient quedo `revoked`, el mensaje desaparecio del
inbox y un evento posterior fue rechazado con HTTP 409. No hubo borrado fisico.

La expiracion minima productiva es 300 segundos. Para no prolongar
innecesariamente credenciales de prueba, no se forzo una espera productiva. La
barrera server-side queda validada por la prueba automatizada que coloca un
mensaje despues de `expires_at`, confirma inbox vacio, rechaza eventos con HTTP
410 y expone `expired` en el listado humano. No se cambio el reloj, la DB ni la
configuracion.

## 12. Listado humano e incidente PostgreSQL

La primera ejecucion funcional encontro HTTP 500 al listar mensajes. El
traceback mostro `psycopg2.errors.UndefinedFunction`: el conteo aplicaba
`DISTINCT` a toda la fila, incluida una columna PostgreSQL `json` sin operador
de igualdad.

El PR #24 cambio el conteo para deduplicar solo IDs y la pagina para usar solo
`id` y `created_at` antes de cargar las filas completas. Una regresion captura
el SQL emitido y exige que el conteo no incluya `metadata_json`.

Tras el autodeploy correctivo se repitio toda la matriz. El listado y el
detalle humano respondieron HTTP 200, con timeline saneado,
`acknowledged_count=1`, `terminal_count=1` y timestamps server-side. La ventana
final registro cero HTTP 5xx.

## 13. Privacidad y logs

La ventana web final registro 14 lecturas de inbox, 21 llamadas al endpoint de
eventos y un listado humano HTTP 200. Los conteos de seguridad fueron cero para:

- HTTP 5xx;
- tracebacks y `StatementError`;
- JWT, access tokens y refresh tokens;
- pairing codes e idempotency keys;
- correo de prueba;
- cuerpo completo del mensaje;
- hashes internos;
- datos clinicos.

Los logs registraron rutas, status codes y cursors opacos en query string, no
credenciales. Ningun cursor completo se copia en esta documentacion.

## 14. Limpieza final

La limpieza se ejecuto dentro de `finally`, incluida la ejecucion que detecto
el incidente. En la repeticion final:

- cuatro mensajes fueron revocados por API con HTTP 200;
- tres devices fueron revocados por API con HTTP 200;
- pairings pendientes encontrados: 0;
- devices de prueba activos: 0;
- device access despues de revocar: HTTP 401;
- device refresh despues de revocar: HTTP 401;
- cierre global de sesiones humanas: HTTP 200;
- human access despues del cierre: HTTP 401;
- human refresh despues del cierre: HTTP 401;
- tokens activos de prueba finales: 0.

La revocacion de devices invalido grants y familias de credenciales. Los
mensajes y eventos permanecen solo como trazabilidad terminal o revocada, sin
contenido sensible. No se uso SQL para limpiar.

## 15. Validacion automatizada

Despues de los fixes:

- backend local: 397 pruebas aprobadas;
- modulo de mensajes: 28 pruebas aprobadas;
- `ruff`: aprobado;
- `black --check`: aprobado;
- `git diff --check`: aprobado;
- Frontend build en CI: aprobado;
- Migrations check en CI: aprobado;
- Secret scan en CI: aprobado.

## 16. Alcance preservado

- Railway no recibio cambios manuales;
- PostgreSQL no recibio SQL manual;
- worker no fue modificado;
- Klinip One no fue modificado;
- no se creo UI ni polling cliente;
- no se enviaron mensajes a usuarios reales;
- no se tocaron medicamentos, citas, documentos, IA clinica, audio o ubicacion.

Los siete elementos no rastreados preexistentes del worktree se mantuvieron
intactos y nunca se agregaron a Git.

## 17. Estado y siguiente etapa

Device Messaging v0.7.3b queda activado y validado en produccion. La propiedad
principal queda demostrada: varias descargas conservan el recipient en
`queued`, version 1, cero intentos y cero eventos; cada estado posterior exige
una llamada explicita al endpoint de eventos.

La siguiente etapa autorizada es v0.7.4 Klinip One Cloud Connector, que debe
iniciarse posteriormente y no forma parte de este cierre.
