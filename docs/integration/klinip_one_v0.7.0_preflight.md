# Klinip One v0.7.0 Preflight

Fecha: 2026-07-22

Rama: `fix/v0.7.0-security-test-preflight`

Base: `b8780efa8630931af16e4e7dcc601f9398920bae`

## Objetivo

Estabilizar y asegurar la base de Klinip antes de diseñar su integración con
Klinip One. Esta iteración sanea el logging de base de datos y corrige las tres
pruebas backend que fallaban en el baseline auditado.

## Alcance

- Parseo seguro de `DATABASE_URL`.
- Logging mínimo de la configuración de base de datos.
- Pruebas de no filtración con valores exclusivamente ficticios.
- Estabilización de recordatorios de citas.
- Corrección de asignación de tomas y clasificación de tardanza.
- Suite backend completa y build frontend.

## Fuera de alcance

No se agregaron endpoints, modelos, migraciones ni funciones clínicas. No se
iniciaron Device Identity, pairing, mensajería, acknowledgements, outbox,
polling, WebSocket, SSE ni conexión con Klinip One. Railway y producción no
fueron consultados ni modificados.

## Estado inicial

- Rama base `main` sincronizada con `origin/main`, ahead/behind `0/0`.
- HEAD `b8780efa8630931af16e4e7dcc601f9398920bae`.
- Sin cambios versionados; siete elementos no rastreados preexistentes.
- Backend: 260 pruebas, 257 aprobadas y 3 fallidas.
- Frontend: build aprobado en la auditoría previa.
- `git diff --check`: limpio.

## Riesgo de `DATABASE_URL`

`backend/app/database.py` agregaba `sslmode=require` mediante parseo manual y
después imprimía la parte de la URL anterior a `@`. En una URL PostgreSQL
convencional esa porción puede contener usuario y contraseña. El código podía
exponer esas credenciales en logs cuando SSL no venía configurado.

El patrón fue introducido por el commit
`7bf25e6e2335ce9978a0dfa5c1489d5a34d2afe8` el 2025-12-16 y permanecía en la
base auditada. No se encontraron coincidencias en los logs locales disponibles.
No se inspeccionaron logs de Railway, por lo que no existe evidencia para
afirmar que una credencial fue expuesta.

Acción operativa pendiente: revisar externamente los logs históricos de
Railway sin copiar valores sensibles. Si el mensaje inseguro aparece, rotar
manualmente las credenciales de base de datos y revisar accesos. Esta iteración
no ejecutó ninguna rotación.

## Solución de logging

- SQLAlchemy `make_url` reemplaza el parseo y reconstrucción manual.
- El alias `postgres://` se normaliza antes del parseo.
- `sslmode=require` se agrega mediante el objeto URL cuando no existe.
- Solo se admiten PostgreSQL y SQLite, que son los backends soportados.
- Una URL inválida o no soportada produce un error genérico sin incluir input.
- El log informa únicamente `postgresql on configured host`, `sqlite (memory)`
  o `sqlite (file)`.
- No se registran URL, host, puerto, usuario, contraseña, ruta ni query params.

## Pruebas de no filtración

`backend/tests/test_database_logging.py` usa exclusivamente valores ficticios:

- usuario y contraseña sensibles simulados;
- contraseña con `@` escapado;
- query params sensibles simulados;
- puerto personalizado;
- PostgreSQL con y sin host;
- SSL existente y agregado;
- SQLite en memoria, archivo y URL ausente;
- URL inválida y backend no soportado;
- inicialización de engines sin abrir conexiones de red.

Las aserciones fallan si el usuario, contraseña, token, URL completa o ruta
aparecen en el log o en mensajes de error.

## Recordatorios de citas

### Causa

La prueba creaba la cita con `datetime.now()` del reloj local de Windows, pero
el job calculaba el vencimiento en `America/Santiago`. En el entorno auditado,
la ausencia de datos IANA hizo que el fallback tuviera una hora de diferencia,
dejando la cita fuera de la ventana. La selección del cuidador sí era correcta.

También se detectó que el job registraba e incrementaba `email_sent` aunque el
wrapper del proveedor hubiera capturado un error.

### Solución

- La prueba de routing controla explícitamente `_is_due`; ya no depende del
  reloj real ni del timezone del host.
- Los destinatarios familiares deben tener relación aceptada y permiso
  efectivo `receive_alerts`.
- Propietario y cuidador se deduplican.
- Relaciones revocadas, cuidadores sin permiso y viewers sin permiso quedan
  excluidos.
- El wrapper de correo devuelve éxito/fallo y el job solo registra un envío
  confirmado; un fallo incrementa `errors` sin crear log de envío.

Las pruebas cubren propietario con canal, propietario sin canal con cuidador
autorizado, ambos con canal, ausencia total de canal, permiso denegado, relación
revocada, viewer sin permiso, deduplicación y fallo simulado del proveedor. No
se envía correo real.

## Tomas y adherencia

### Causa

La normalización solo corregía un slot futuro cuando `scheduled_at` no había
sido enviado explícitamente. Si el cliente enviaba la dosis de las 20:00 para
una toma realizada a las 08:10, el slot futuro se conservaba y la tardanza se
calculaba contra la dosis equivocada.

### Regla aplicada

- Un slot explícito se conserva si la toma ocurre hasta 15 minutos antes.
- Si el slot está más de 15 minutos en el futuro respecto de una toma real, la
  toma se reasigna a la última dosis ya debida.
- La tardanza se clasifica después de seleccionar el slot correcto.
- Hasta 90 minutos después del slot se conserva `taken`; más de 90 minutos es
  `late`.
- Eventos no tomados, como `skipped`, no consumen un slot futuro.

Las pruebas cubren toma anticipada, puntual, límite de tolerancia, tardía, muy
tardía, slot futuro, cruce de medianoche, múltiples horarios, timestamps aware,
deduplicación, backfill existente y adherencia diaria existente. No se cambió
el esquema ni se creó una nueva arquitectura de medicamentos.

## Baseline final

- Baseline anterior: 260 pruebas; 257 aprobadas y 3 fallidas.
- Pruebas nuevas: 22.
- Baseline final: **282 pruebas; 282 aprobadas, 0 fallidas**.
- Omitidas/xfail: 0.
- Warnings: 38, todos de categorías preexistentes.
- Duración registrada: 13,54 segundos.

Warnings no bloqueantes pendientes:

- `Config` y `dict()` obsoletos en Pydantic v2.
- relación SQLAlchemy solapada de episodios clínicos.
- `FastAPI.on_event` obsoleto.

## Frontend

Build ejecutado con `VITE_BUILD_OUT_DIR` fuera del repositorio:

- resultado: aprobado;
- módulos transformados: 158;
- duración Vite: 3,83 segundos;
- JS principal: aproximadamente 378,25 kB;
- CSS principal: aproximadamente 1.106,88 kB;
- warning preexistente: API CJS de Vite obsoleta;
- no se generaron artefactos dentro del repositorio.

## Riesgos pendientes

- Revisar logs externos y decidir rotación manual de DB.
- Confirmar rama, commit y worker reales en Railway.
- Proteger `main` y agregar CI.
- Resolver warnings y deuda de migraciones en etapas separadas.
- Diseñar identidad y revocación de dispositivo antes de cualquier conexión.

## Estado de integración

Railway sigue pendiente de verificación externa. Klinip One no está conectado.
Device Identity no fue iniciada.

## Próximo paso autorizado

`v0.7.1 Railway Verification and Repository Protection`.

## Seguimiento v0.7.1

El resultado de la preparación local de CI y del intento de verificación
Railway está documentado en
[`klinip_one_v0.7.1_railway_ci.md`](klinip_one_v0.7.1_railway_ci.md).

Railway quedó no verificable porque la CLI no estaba autenticada. No se
consultaron ni modificaron servicios, variables, despliegues o logs.
