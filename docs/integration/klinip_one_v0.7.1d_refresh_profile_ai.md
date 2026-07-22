# Klinip Cloud Integration v0.7.1d - Refresh Profile AI Worker Stabilization

Fecha: 2026-07-22

Repositorio: `Diegogigi/klinip`

Rama de correccion: `fix/v0.7.1d-refresh-profile-ai-worker`

Base: `11d1599abe6d70c00fb8a1afc35f985c0bc498e8`

## 1. Contexto

La primera activacion controlada del worker de v0.7.1c comprobo cuatro ciclos,
locks, continuidad del proceso y ausencia de duplicaciones. Sin embargo,
`refresh_profile_ai` registro `StatementError` y rollback en tres ciclos
consecutivos. El worker se detuvo y se elimino; Railway quedo nuevamente con
solo `klinip` y `Postgres`.

## 2. Sintoma remoto

El job terminaba su ciclo, pero un perfil permanecia marcado para refresco y se
volvia a seleccionar en el ciclo siguiente. No hubo crash del worker ni impacto
observado en el servicio web.

## 3. Evidencia disponible

Los logs historicos detallados del worker eliminado ya no estan disponibles en
Railway. La evidencia remota se limita a la clase `StatementError`, los tres
rollbacks consecutivos y los conteos agregados registrados durante la
activacion. No se infiere ni se documenta contenido de usuarios.

El error se reprodujo de forma determinista con SQLite y datos ficticios. La
operacion fallida fue:

- modelo: `DocumentCoverageInfo`;
- columna: `metadata_json` de tipo JSON;
- operacion: `UPDATE document_coverage_info`;
- fase SQLAlchemy: bind durante autoflush;
- excepcion: `sqlalchemy.exc.StatementError`;
- causa original: `TypeError` por un `datetime` no serializable como JSON.

## 4. Causa raiz

Una correccion manual de cobertura conserva `manual_override=true`. Durante
`_refresh_profile_ai_analytics`, `_upsert_document_coverage_info` guardaba el
payload completo de la nueva deteccion bajo `latest_auto_detection`. Ese
payload contenia valores `datetime` nativos producidos por la extraccion de
fechas. El valor llegaba sin normalizar a la columna JSON y fallaba en el
autoflush posterior.

El rollback mantenia correctamente el perfil como pendiente. Por eso el mismo
perfil volvia a intentarse y el error reaparecia en cada ciclo.

## 5. Por que ocurria en el worker

El worker procesa automaticamente todos los perfiles `ai_needs_refresh` y
recorre tambien la inteligencia documental. La ruta web de correccion manual
solo prepara el estado; el payload incompatible se reconstruye cuando el job
actualiza el perfil. No existe una diferencia de dialecto necesaria para
reproducir el fallo.

## 6. Impacto

El perfil afectado no completaba su resumen ni limpiaba la marca de refresh.
Los perfiles posteriores podian continuar gracias al rollback por entidad, y
el runtime seguia con los jobs restantes. No se detecto escritura parcial,
perdida de lock, envio externo ni modificacion del esquema.

## 7. Relacion con refresh_family_ai

`refresh_family_ai` no ejecuta `_upsert_document_coverage_info`, por lo que no
comparte la causa directa. Mientras exista un perfil pendiente, Family AI lo
omite de manera intencional y puede parecer bloqueado indirectamente.

Ambos jobs escriben columnas JSON. Por defensa en profundidad, las fronteras de
persistencia de los resumenes de perfil y familia usan el mismo normalizador.
La prueba de Family AI confirma que permanece registrado, procesa las ventanas
de 7 y 30 dias y completa su commit.

## 8. Correccion

Se agrego `normalize_json_payload`, un helper estricto que conserva la
estructura y convierte explicitamente `datetime`, `date`, `time`, `UUID`,
`Enum`, `Decimal` finito y modelos Pydantic a tipos JSON. Rechaza ciclos,
numeros no finitos y tipos desconocidos; no convierte objetos arbitrarios a
texto.

La normalizacion se aplica antes de persistir:

- `DocumentCoverageInfo.metadata_json.latest_auto_detection`;
- `ProfileAiSummary.summary_json`;
- `FamilyAiSummary.profiles_json` y `summary_json`.

`refresh_profile_ai` sigue activo. No se omiten commits, no se borran datos y
no se ocultan errores de base.

## 9. Rollback

Ante un error por perfil o familia, el job ejecuta `rollback`, incrementa
metricas agregadas, registra solo clase, fase y motivo saneados, y continua con
la siguiente entidad cuando es seguro. La sesion se cierra siempre en
`finally`; el ciclo siguiente crea una sesion nueva.

Para revertir operativamente una activacion fallida se debe detener y eliminar
solo `klinip-worker`, mantener el web y PostgreSQL, y conservar
`ENABLE_EMBEDDED_SCHEDULER=false`.

## 10. Sesiones y transacciones

La reproduccion confirma que el `StatementError` deja la transaccion en estado
fallido hasta el rollback. Las pruebas verifican rollback, continuidad con otro
perfil, cierre de sesion, sesion nueva en el ciclo siguiente y liberacion del
lock por el runtime. Un ciclo integrado sobre el caso original refresca una vez
y el ciclo siguiente ya no vuelve a seleccionarlo.

## 11. Pruebas

La cobertura nueva incluye:

- reproduccion y correccion del payload de cobertura manual con `datetime`;
- payloads validos, anidados, nulos, `Enum`, `UUID`, `Decimal` y Pydantic;
- rechazo de valores inesperados, ciclos y numeros no finitos;
- error de bind/autoflush y error de commit;
- rollback, continuidad con otro perfil y logs sin contenido sensible;
- sesion nueva en el siguiente ciclo;
- dos ciclos integrados sin reintento del perfil corregido;
- Family AI activo y funcional;
- runtime, lock, timeout y ausencia de llamadas a proveedores reales.

## 12. Limitaciones

Un tipo realmente desconocido se rechaza y el perfil conserva su marca para no
perder datos ni fabricar un resumen. El job queda degradado y continua con las
demas entidades. Un backoff por entidad o dead-letter podria evitar reintentos
indefinidos de futuros datos incompatibles, pero no se implementa una cola en
esta iteracion.

## 13. Despliegue

La correccion debe entrar por PR protegido a `main`, con Backend tests,
Frontend build, Migrations check y Secret scan aprobados. Despues se debe
esperar el autodeploy web exitoso y comprobar `/health` HTTP 200 y scheduler
web desactivado.

## 14. Reactivacion del worker

Solo despues del despliegue web se recreara `klinip-worker` con una replica,
`ON_FAILURE`, sin dominio publico, sin volumen y con el scheduler embebido
desactivado. Se observaran entre cuatro y seis ciclos reales sin ejecutar jobs
manualmente.

El cierre requiere cero `StatementError` repetidos, crash loops, duplicaciones,
timeouts y reinicios; locks liberados, ambos refresh estables y web saludable.

## 15. Fuera de alcance

No hay cambios de UI, modelos, migraciones, reglas clinicas, medicamentos,
citas, Family Connector, PostgreSQL, DNS, Cloudflare, secretos, hardware ni
Klinip One.

## 16. Device Identity

Device Identity y Pairing no fueron iniciados. v0.7.2 permanece fuera de esta
iteracion hasta cerrar toda la validacion remota de v0.7.1d.
