# Klinip Cloud Integration v0.7.1 - Railway and CI Foundation

Fecha de cierre remoto: 2026-07-22

Repositorio auditado: `Diegogigi/klinip`

Rama: `chore/v0.7.1-railway-ci-foundation`

Base funcional: `e8a74b3eca8969898015a2768c95e1a1ab54e767`

## Objetivo

Cerrar la verificacion remota de Railway y activar las salvaguardas de CI y
proteccion de `main` antes de iniciar Device Identity.

La inspeccion de Railway fue exclusivamente de lectura. No se realizaron
deploys, reinicios, cambios de variables, migraciones, escrituras en base de
datos ni modificaciones de dominio.

## Railway

### Cuenta y proyecto

- Railway CLI: `4.8.0`.
- Workspace: `diegogigi's Projects`.
- Proyecto: `klinip`.
- Environment: `production`.
- Servicios: `klinip` y `Postgres`.
- No existe un servicio worker separado.

La vinculacion del CLI se creo fuera del repositorio, en un directorio
temporal de auditoria. No se agrego configuracion Railway al worktree.

### Servicio web

- Servicio: `klinip`.
- Repositorio fuente: `Diegogigi/klinip`.
- Rama reportada por el ultimo deployment: `main`.
- Ultimo commit reportado: `b8780efa8630931af16e4e7dcc601f9398920bae`.
- Estado del ultimo deployment: `FAILED` y detenido.
- Builder: Nixpacks, build environment V3, runtime V2.
- Build command remoto: sin override.
- Start command remoto: sin override.
- Root directory: sin override.
- Health check path remoto: sin configurar.
- Region efectiva: `us-east4-eqdc4a`.
- Replicas: 1.
- Railway domain: `klinip-production.up.railway.app`, puerto 8080.
- Custom domain: `www.klinip.cl`, puerto 8080.
- Volumen: `klinip-volume`, montado en `/uploads/voice`.

El ultimo deployment visible esta fallido, pero ambos endpoints publicos
respondieron HTTP 200 en `/health`. Esto indica que Railway continua sirviendo
un deployment anterior saludable. El CLI 4.8.0 no expuso el commit de ese
deployment activo anterior, por lo que no se afirma que el proceso actualmente
servido corresponda exactamente a `b8780efa`.

### PostgreSQL

- Servicio: `Postgres`.
- Imagen: `ghcr.io/railwayapp-templates/postgres-ssl:17`.
- Estado del ultimo deployment: `SUCCESS`.
- Region efectiva: `us-east4-eqdc4a`.
- Replicas: 1.
- Volumen: `postgres-volume`, montado en `/var/lib/postgresql/data`.

No se abrio una consola SQL, no se leyeron datos y no se ejecutaron
migraciones en produccion.

### Variables

Se verificaron solamente nombres. Entre los nombres presentes estan:

- aplicacion y red: `ALLOWED_ORIGINS`, `APP_DISPLAY_NAME`,
  `FRONTEND_BASE_URL`, `VOICE_UPLOAD_DIR`;
- base de datos y seguridad: `DATABASE_URL`, `SECRET_KEY`;
- IA: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MAX_OUTPUT_TOKENS`,
  `OPENAI_TEMPERATURE`;
- correo: `EMAIL_PROVIDER`, `EMAIL_API_TIMEOUT`, `EMAIL_FROM`,
  `EMAIL_LOGO_URL`, `EMAIL_TO_PRIVACY`, `EMAIL_TO_SUPPORT`,
  `MAIL_FROM_NOTIFICATIONS`, `MAIL_FROM_SECURITY`, `RESEND_API_KEY`;
- push: `VAPID_EMAIL`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`,
  `VITE_VAPID_PUBLIC_KEY`;
- scheduler: `ENABLE_EMBEDDED_SCHEDULER`;
- variables internas inyectadas por Railway.

No se imprimio ni documento ningun valor.

## Worker y scheduler

Clasificacion: **D. Ninguno activo, con riesgo de ausencia de jobs**.

Evidencia:

- Railway solo contiene los servicios `klinip` y `Postgres`;
- no existe worker separado;
- `nixpacks.toml` fuerza `ENABLE_EMBEDDED_SCHEDULER=false` en migraciones y en
  el proceso web;
- no se ejecutaron jobs para comprobar efectos laterales.

Mientras esta configuracion se mantenga, recordatorios, correos, push y otras
tareas programadas pueden no ejecutarse. La solucion corresponde a una etapa
posterior controlada; no se modifico Railway en este cierre.

## Rama, commit y autodeploy

- `origin/main`: `b8780efa8630931af16e4e7dcc601f9398920bae`.
- Preflight v0.7.0: `e8a74b3eca8969898015a2768c95e1a1ab54e767`.
- Commit inicial v0.7.1: `577e281c559b32086a1a35343c2f20c2adc49424`.
- Railway reporta repositorio `Diegogigi/klinip` y rama `main`.
- Los pushes a `chore/v0.7.1-railway-ci-foundation` no cambiaron el deployment
  reportado por Railway.

La evidencia confirma que la rama feature no despliega produccion. La fuente
esta conectada a `main` y es compatible con el flujo esperado de autodeploy,
pero el CLI no expone directamente el interruptor de autodeploy. No se cambio
esa configuracion.

## Health

Comprobaciones de lectura:

- `GET https://klinip-production.up.railway.app/health`: HTTP 200.
- `GET https://www.klinip.cl/health`: HTTP 200.

El servicio esta alcanzable pese al ultimo intento de deployment fallido. No
se probaron endpoints privados ni se realizaron pruebas de carga.

## Logs historicos

Clasificacion: **D. No verificable por retencion o acceso historico del CLI**.

Se busco solamente la estructura del antiguo mensaje
`DEBUG: DATABASE_URL configurada con SSL:` en el unico deployment identificable
por Railway CLI. Ese deployment no conserva logs de ejecucion y devolvio cero
lineas. No se copiaron logs ni se mostraron URL, usuario, password, host,
parametros o tokens.

El commit de produccion identificado contiene la implementacion antigua que
generaba ese mensaje. Aunque no fue posible demostrar su presencia en logs
retenidos, se recomienda una rotacion manual precautoria de las credenciales
PostgreSQL antes de ampliar el alcance de integraciones. No se realizo rotacion
automatica.

## GitHub CI

Rama publicada:

`chore/v0.7.1-railway-ci-foundation`

Pull request:

[PR #1 - chore: add CI safeguards and Railway deployment documentation](https://github.com/Diegogigi/klinip/pull/1)

El PR permanece abierto como borrador y no fue fusionado.

### Ajustes exclusivos del runner

La primera publicacion revelo tres diferencias del entorno limpio de GitHub:

1. Los valores `sqlite:///:memory:` requerian comillas para ser YAML valido.
2. `pytest` no forma parte de las dependencias runtime y debia instalarse en el
   job backend.
3. El backend exige `SECRET_KEY`; CI usa una clave estatica explicitamente
   aislada para pruebas, sin reutilizar credenciales de Railway.

Commits de correccion:

- `21b39d7` - `fix: align CI environment with local validation`.
- `5605457` - `fix: install pytest in CI backend job`.
- `0c51d1b` - `fix: provide isolated test secret in CI`.

### Ejecucion verde

Workflow run 4:

https://github.com/Diegogigi/klinip/actions/runs/29897345165

- `Backend tests`: success, 282 passed, 39 warnings, 33 s de job.
- `Frontend build`: success, 158 modulos, 18 s de job.
- `Migrations check`: success, un unico head, 17 s de job.
- `Secret scan`: success, 12 s de job.

No se desactivaron pruebas, no se suavizo Gitleaks y no se agregaron secretos.

## Proteccion de main

La proteccion de `main` fue aplicada despues de crear los cuatro checks:

- pull request obligatorio;
- cero aprobaciones obligatorias para el mantenedor individual;
- conversaciones resueltas;
- rama actualizada antes de merge (`strict: true`);
- checks requeridos: `Backend tests`, `Frontend build`, `Migrations check` y
  `Secret scan`;
- force pushes bloqueados;
- eliminaciones bloqueadas;
- reglas no forzadas sobre administradores para conservar recuperacion.

El mecanismo de recuperacion es la cuenta administrativa `Diegogigi`, que
puede corregir la regla desde Repository Settings o mediante GitHub CLI
autenticado. No se habilito auto-merge.

## Validacion local

- `actionlint`: workflow valido.
- Backend: 282/282 aprobadas, 38 warnings preexistentes.
- Frontend: build aprobado, 158 modulos.
- `git diff --check`: aprobado antes de los commits de CI.
- Siete elementos no rastreados preexistentes permanecen fuera del alcance.

## Limites y acciones pendientes

- El commit exacto del deployment saludable actualmente servido no es visible
  porque el ultimo intento esta fallido y detenido.
- Los logs historicos inseguros no son recuperables mediante el CLI usado.
- Se recomienda rotacion manual precautoria de PostgreSQL.
- Falta definir y desplegar de forma controlada un worker separado si los jobs
  programados deben estar activos.
- El PR #1 debe revisarse; este cierre no autoriza su merge.

## Confirmaciones de alcance

- Railway no fue modificado.
- No hubo deploy manual.
- No hubo merge.
- No se modifico `main` directamente.
- No se inicio Device Identity ni pairing.
- No se modifico Klinip One.

La etapa v0.7.2 permanece pendiente de autorizacion explicita.

## Extension v0.7.1c

La base local del worker de produccion se documenta en
[`klinip_one_v0.7.1c_worker_foundation.md`](./klinip_one_v0.7.1c_worker_foundation.md).
Esa extension prepara locks, ciclo, senales, observabilidad y pruebas, pero no
crea el servicio worker en Railway.

El deployment rojo visible permanece clasificado como historico no bloqueante.
No se realizo redeploy. La creacion y validacion remota del worker sigue siendo
una accion operativa pendiente de autorizacion explicita.

## Activacion remota posterior

El PR #1 fue convertido a listo y fusionado mediante merge commit
`a9b7635228e6569f0434e8a52c026c5ce1324a1c`, con los cuatro checks requeridos
en verde. `main` quedo protegida y la rama local se sincronizo sin push directo.

El soporte de deteccion Python para Railpack se incorporo posteriormente por
el PR #15. Su merge commit
`e390a802029912254a67326b94ff44ed59dd7afd` activo el autodeploy web
`a334ab4c-e211-43f4-8b0d-23f6c83e43df`, que termino en `SUCCESS`. El dominio
publico respondio HTTP 200 en `/health` y el log de startup confirmo que el
scheduler embebido del web estaba desactivado.

Se creo `klinip-worker` con una replica, `ON_FAILURE` y sin dominio publico. El
deployment llego a iniciar y completo cuatro ciclos, pero se detuvo mediante
rollback preventivo al repetirse un `StatementError` interno en
`refresh_profile_ai`. El detalle operativo y el mecanismo contra duplicacion
estan registrados en
[`klinip_one_v0.7.1c_worker_foundation.md`](./klinip_one_v0.7.1c_worker_foundation.md).

No se modifico PostgreSQL, no se rotaron credenciales, no se ejecutaron jobs
manualmente y no se inicio Device Identity. El worker no se considera activo
ni v0.7.1c cerrada hasta resolver el error recurrente en una iteracion
autorizada.
