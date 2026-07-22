# Klinip One v0.7.1 Railway and CI Foundation

Fecha: 2026-07-22

Rama: `chore/v0.7.1-railway-ci-foundation`

Base: `e8a74b3eca8969898015a2768c95e1a1ab54e767`

## Objetivo

Verificar Railway en modo lectura cuando el acceso lo permita y preparar una
base local de CI, mantenimiento y protección del repositorio antes de iniciar
Device Identity.

## Alcance

- Descubrimiento seguro del acceso Railway.
- Health check público no destructivo.
- Revisión local de Nixpacks, worker y scheduler.
- GitHub Actions para backend, frontend, migraciones y secretos.
- Dependabot semanal para npm, pip y GitHub Actions.
- CODEOWNERS con el mantenedor confirmado.
- Guía de protección de `main` y relación con autodeploy.

No se modificaron Railway, producción, DNS, Cloudflare, base de datos, UI,
modelos, endpoints, migraciones ni Klinip One. Device Identity no fue iniciada.

## Estado inicial

- Rama inicial: `fix/v0.7.0-security-test-preflight`.
- HEAD: `e8a74b3eca8969898015a2768c95e1a1ab54e767`.
- Sin cambios versionados pendientes.
- Siete elementos no rastreados preexistentes, excluidos de esta iteración.
- `origin/main`: `b8780efa8630931af16e4e7dcc601f9398920bae`.
- El commit v0.7.0 continúa únicamente local; no fue desplegado.

## Acceso Railway

Railway CLI `4.8.0` está instalada. `railway whoami` respondió `Unauthorized`.
No se inició login, no se solicitó token y no se leyó configuración remota.

Clasificación: **Railway no verificable por falta de autenticación**.

## Proyecto y environment

No verificables. La documentación local usa el término `backend`, pero no es
evidencia suficiente del nombre real del proyecto, workspace, environment o
servicio en Railway.

No se pudieron confirmar:

- workspace y proyecto;
- environment de producción;
- servicios y regiones;
- réplicas;
- PostgreSQL o storage adicional;
- variables remotas por nombre;
- repositorio y rama conectados;
- política de autodeploy;
- último deployment y su estado.

## Rama y commit desplegados

No verificables. El health público no expone metadatos de commit y no se asumió
que Railway despliega `main`.

Comparación Git conocida:

- `origin/main` y `main`: `b8780efa...`;
- preflight v0.7.0 local: `e8a74b3...`;
- rama v0.7.1: derivada de `e8a74b3...`.

La producción puede coincidir con `origin/main`, estar atrasada o desplegar
otra rama. Se requiere evidencia remota para clasificarla.

## Configuración local de despliegue

`nixpacks.toml` define:

- Node 18 y Python 3.11;
- instalación npm y pip;
- build Vite dentro de `backend/static`;
- `alembic upgrade head` antes de iniciar;
- Uvicorn en `$PORT`;
- `ENABLE_EMBEDDED_SCHEDULER=false` forzado en el proceso web.

Esto describe el build esperado por el repositorio, no confirma los overrides
configurados en Railway.

## Worker y jobs

Estado remoto: **no verificable**.

El repositorio contiene `python -m app.worker` como proceso posible. La
documentación local recomienda un worker separado, pero no prueba que exista.
Como Nixpacks desactiva el scheduler embebido en web, hay dos riesgos:

- sin servicio worker, los jobs programados no se ejecutarían;
- si Railway sobrescribe el start command y habilita ambos, podrían duplicarse.

La configuración real debe comprobarse sin disparar jobs. La ausencia de una
cola durable sigue siendo un riesgo de disponibilidad y deduplicación.

## Health check

Solicitud realizada: `GET https://www.klinip.cl/health`.

- HTTP: `200`;
- latencia aproximada: `0,55 s`;
- respuesta general: estado `ok`;
- timestamp reportado: `2026-07-22T05:58:58.685568Z`.

`app.klinip.cl` no resolvió DNS desde el entorno de validación. No se realizaron
login, endpoints privados, escrituras ni pruebas de carga.

## Revisión segura de logs

No se pudo acceder a logs Railway porque la CLI no está autenticada. No se
descargaron ni copiaron logs.

Clasificación: **D. No verificable por acceso**.

La revisión externa pendiente debe buscar solo la presencia estructural del
antiguo mensaje de configuración de DB y registrar servicio, rango temporal y
cantidad aproximada, sin copiar su contenido.

## Decisión sobre rotación

No existe evidencia nueva para afirmar exposición ni para ordenar una rotación
automática. La decisión queda pendiente de la revisión segura de logs:

- si el mensaje no aparece: registrar resultado y conservar monitoreo;
- si aparece sin material sensible visible: evaluar alcance y retención;
- si hay indicios de material sensible: detener la revisión y rotar
  manualmente credenciales de PostgreSQL, revisando sesiones y accesos.

## CI preparado localmente

`.github/workflows/ci.yml` se activa en pull requests y pushes a `main`, además
de `workflow_dispatch`. Tiene permisos globales `contents: read`, concurrencia
cancelable, timeouts y no contiene pasos de deploy.

### Backend tests

- Ubuntu, Python 3.11 y cache pip.
- Dependencias desde `backend/requirements.txt`.
- SQLite en memoria.
- Scheduler desactivado.
- Suite completa sin correos, push, OpenAI ni DB de producción.

### Frontend build

- Ubuntu, Node 18 y cache npm.
- `npm ci` en `frontend`.
- Vite escribe en `${{ runner.temp }}`.
- No publica artefactos ni despliega.

### Migrations check

- Instala dependencias backend con Python 3.11.
- Inspecciona `alembic heads` y exige exactamente un head.
- Lista el historial de migraciones.
- No ejecuta `upgrade` ni conecta a producción.

### Secret scan

- Checkout con historial completo.
- Gitleaks Action v2.3.9 fijada por SHA.
- Usa solo el token efímero de GitHub con permiso de lectura.
- `.gitleaks.toml` extiende reglas por defecto.
- La única allowlist exige simultáneamente la ruta de la prueba de logging y
  uno de sus tres marcadores explícitamente ficticios.

Las actions de checkout, setup-python y setup-node también están fijadas por
SHA y documentan su versión legible.

## Estado real del CI

La configuración está preparada y validada localmente, pero **GitHub Actions
no la ha ejecutado** porque esta rama no fue publicada. Los cuatro checks no
existirán como status checks seleccionables hasta autorizar el push y completar
al menos una ejecución en GitHub.

## Dependabot

`.github/dependabot.yml` programa actualizaciones semanales para:

- npm en `/frontend`;
- pip en `/backend`;
- GitHub Actions en `/`.

Los PR abiertos están limitados y no existe auto-merge.

## CODEOWNERS

El usuario público `Diegogigi` fue confirmado mediante la API pública de
GitHub. `.github/CODEOWNERS` asigna el repositorio a `@Diegogigi` sin inventar
equipos ni otros usuarios.

CODEOWNERS tendrá efecto remoto únicamente después del push.

## Protección recomendada para main

No se aplicó protección remota.

### Configuración ideal

- exigir pull request;
- al menos una aprobación;
- descartar aprobaciones obsoletas;
- resolver conversaciones;
- exigir rama actualizada;
- exigir `Backend tests`, `Frontend build`, `Migrations check` y `Secret scan`;
- bloquear force pushes y eliminaciones;
- restringir pushes directos;
- incluir administradores.

### Configuración práctica para un mantenedor

- exigir pull request con cero aprobaciones obligatorias;
- exigir resolución de conversaciones y los cuatro checks;
- exigir rama actualizada;
- bloquear force pushes y eliminaciones;
- conservar un mecanismo administrativo documentado de recuperación.

Exigir una aprobación con un único mantenedor impediría que el autor aprobara
su propio PR. Debe habilitarse cuando exista un segundo revisor real.

### Orden de aplicación remota

1. Autorizar push de la rama.
2. Abrir PR hacia `main`.
3. Verificar una ejecución completa y verde del workflow.
4. Confirmar los nombres exactos de los cuatro status checks.
5. Crear la regla de protección/ruleset en GitHub.
6. Probar el flujo con un PR pequeño antes de restringir administradores.

## Interacción con Railway autodeploy

Estado actual: no verificable.

Flujo objetivo:

```text
feature branch -> pull request -> CI verde -> merge a main -> Railway despliega main
```

Railway debe observar solo `main` para producción. La protección de GitHub
controla qué llega a `main`, pero no reemplaza la verificación de branch filter,
autodeploy, root directory y start command dentro de Railway.

## Validación local

- Backend: 282/282 aprobadas; 38 warnings preexistentes; 12,93 s.
- Frontend: build aprobado; 158 módulos; 3,40 s.
- Alembic: un único head `20260704_000001`.
- TOML de Gitleaks: parseable con Python 3.11.
- Actions fijadas: SHAs comprobadas contra tags remotos.
- `actionlint`: no disponible y no se instaló.
- GitHub Actions: no ejecutado por ausencia de push.

## Riesgos y limitaciones

- Railway, logs, worker, branch y commit desplegados siguen sin verificar.
- La rama v0.7.0 tampoco está en producción.
- CI no tiene evidencia de ejecución en runners GitHub.
- Los status checks todavía no pueden exigirse.
- La protección de `main` sigue ausente hasta una acción remota autorizada.
- Dependencias Python no están completamente fijadas.
- No existe cola durable para jobs.

## Acciones externas pendientes

1. Autorizar login Railway en una sesión controlada y repetir la inspección.
2. Verificar proyecto, environment, servicios, branch, commit y autodeploy.
3. Confirmar worker separado y scheduler web desactivado.
4. Revisar logs históricos con el procedimiento de minimización.
5. Decidir rotación manual según evidencia.
6. Autorizar push de esta rama.
7. Ejecutar CI en GitHub y resolver cualquier diferencia del runner Linux.
8. Aplicar protección de `main` mediante una autorización explícita posterior.

## Siguiente etapa

La preparación local de v0.7.1 puede cerrarse sin push. Las acciones Railway y
GitHub remotas permanecen pendientes y no deben describirse como aplicadas.

Siguiente etapa del plan: `v0.7.2 Device Identity and Pairing Foundation`, solo
después de aceptar explícitamente los pendientes remotos o resolverlos.
