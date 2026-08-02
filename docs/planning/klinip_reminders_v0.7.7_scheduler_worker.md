# Klinip v0.7.7: diseño propuesto de scheduler y worker

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Fecha: 2026-08-02
- Runtime inspeccionado: worker v0.7.1c, advisory locks y ciclo de 60 segundos
- Esquema: [schema y migraciones](klinip_reminders_v0.7.7_schema_and_migrations.md)
- Contrato: [Cloud y dispositivo](../contracts/reminders_cloud_device_contract_v0.7.7.md)

## Objetivo

Definir cómo Klinip Cloud materializaría ocurrencias y deliveries de forma
determinista, recuperable e idempotente. Este documento no modifica el worker,
no registra jobs y no promete ejecución exacta en Android.

El worker Cloud y los mecanismos Android tienen responsabilidades distintas:

- Cloud calcula y materializa ocurrencias dentro de un horizonte;
- el dispositivo descarga y persiste ese horizonte;
- AlarmManager es el scheduler local propuesto para el instante;
- WorkManager solo reconcilia y hace catch-up eventual;
- una notificación Android presenta una señal;
- TTS es una salida separada y sigue pendiente de validación Huawei.

## Job propuesto

Nombre inicial: `materialize_reminder_occurrences`.

Estado: **PROPOSED — NOT IMPLEMENTED**.

El job se incorporaría al registro actual como `retry_safe=True` solo después de
probar que cada escritura tiene constraint e idempotencia persistente. No habrá
endpoint manual para ejecutarlo en producción.

### Frecuencia

- ejecutar en cada ciclo normal del worker, actualmente 60 segundos;
- permitir configuración operativa dentro de 15..300 segundos;
- valor inicial recomendado: 60 segundos;
- incluir timeout y batch size propios dentro del cycle budget existente;
- no crear un segundo proceso scheduler ni un timer embebido en el web service.

Esta frecuencia no es una garantía de segundo exacto. El objetivo Cloud es que
la ocurrencia esté disponible antes del instante; la precisión perceptible se
resuelve localmente tras persistirla.

### Horizonte

- horizonte rodante propuesto: 72 horas;
- máximo propuesto: 100 ocurrencias pendientes por dispositivo en cada respuesta;
- ambos valores son configuración, no constantes del contrato;
- una desconexión mayor se comunica como estado degradado;
- Cloud no inventa ocurrencias en el dispositivo.

## Selección del trabajo

En cada ciclo, dentro de una transacción y un lote acotado:

1. seleccionar `reminders` activos con `next_occurrence_at_utc` anterior al fin
   del horizonte;
2. excluir perfiles archivados y definiciones canceladas/expiradas;
3. ordenar por próxima ocurrencia, ID interno y versión;
4. aplicar row lock y `SKIP LOCKED` en PostgreSQL;
5. recalcular la ocurrencia desde fecha civil, zona IANA y regla versionada;
6. resolver gap/fold según ADR-005;
7. insertar occurrence usando logical occurrence key;
8. resolver el dispositivo preferido y su grant activo;
9. insertar una sola revisión de delivery;
10. avanzar `next_occurrence_at_utc` en la misma transacción;
11. confirmar el lote;
12. repetir mientras exista presupuesto y no se exceda el batch.

No se seleccionan filas usando una ventana inferior como `now - 60s`, porque una
caída podría omitirlas definitivamente.

## Detección de una ocurrencia due

La autoridad temporal es `scheduled_for_utc`. En cada ciclo, antes o después de
materializar, el mismo job puede procesar un sublote de occurrences:

- `scheduled` o `snoozed`;
- `scheduled_for_utc <= server_now`;
- no terminales;
- dentro de la ventana de catch-up.

La transición Cloud a `due` es eventual y queda acotada por la frecuencia del
worker. Klinip One puede alcanzar el instante exacto localmente aunque Cloud aún
no haya realizado esa transición. Una acción válida usa occurrence ID/version y
puede aceptar `scheduled -> completed/snoozed/dismissed` si el server clock ya
confirma que venció, evitando depender de una carrera con el job.

## Transacciones e idempotencia

### Exclusión operativa

- `JobLockManager.acquire("materialize_reminder_occurrences")`;
- PostgreSQL usa advisory lock no bloqueante;
- SQLite de tests usa lock local y no demuestra concurrencia multiproceso;
- un lock no adquirido produce `skipped_lock`, no error ni segundo intento
  simultáneo.

### Corrección persistente

- unique `(reminder_id, schedule_version, logical_occurrence_key)`;
- unique `(occurrence_id, device_id, delivery_revision)`;
- optimistic version en reminder y occurrence;
- row locks al materializar, posponer, completar, descartar o cancelar;
- IntegrityError esperado se resuelve consultando la fila existente y comparando
  sus invariantes, no repitiendo efectos laterales.

El advisory lock reduce carreras; los constraints son la garantía autoritativa.

### Unidad de commit

Cada lote debe confirmar conjuntamente:

- occurrence;
- delivery inicial;
- avance de próxima ocurrencia;
- event técnico `materialized`;
- auditoría saneada.

No se confirma occurrence sin delivery salvo que el reminder pase explícitamente
a `awaiting_device`. No se hacen llamadas de red dentro de la transacción.

## Recuperación después de una caída

| Punto de caída | Resultado al reiniciar |
|---|---|
| Antes del commit | No hay cambios; el reminder vuelve a seleccionarse |
| Después de occurrence, antes de commit | Rollback transaccional |
| Commit aceptado, respuesta interna perdida | Unique key encuentra la misma occurrence |
| Después de delivery | Inbox lo devuelve; descargar no cambia estado |
| Device persiste y red cae | `delivered` permanece en outbox local |
| Evento aceptado y HTTP perdido | Mismo client event devuelve resultado original |

No se usa una bandera en memoria como única evidencia de progreso.

## Catch-up y backlog

Ventana inicial propuesta de recuperación: 24 horas, sujeta a validación de UX y
privacidad.

### One-time

- si venció dentro de la ventana, materializar una occurrence due;
- si es más antiguo, marcar expired con reason code técnico;
- no anunciar automáticamente hasta que la política del dispositivo lo permita.

### Recurrente

- no materializar una ráfaga por cada período perdido;
- registrar como expiradas las instancias lógicas omitidas mediante resumen
  agregado o events técnicos acotados;
- conservar como máximo la última occurrence elegible para catch-up;
- calcular siempre la siguiente fecha civil futura desde la regla y zona IANA.

### Límites

- batch de reminders configurable, recomendado inicial 100;
- batch de due occurrences configurable, recomendado inicial 200;
- máximo de ocurrencias creadas por reminder/ciclo configurable;
- detenerse cooperativamente al alcanzar deadline/cycle budget;
- continuar en el siguiente ciclo sin perder watermark persistente.

Los números son supuestos operativos iniciales, no capacidad validada.

## Varios workers

- una réplica obtiene el advisory lock del job;
- si una futura partición permite varios jobs paralelos, se mantienen row locks y
  unique constraints;
- nunca usar solo `worker replicas=1` como defensa contra duplicados;
- el job debe ser seguro ante reintento completo del ciclo;
- no habilitar retries del runtime hasta probar handlers libres de efectos
  laterales no idempotentes.

## Dispositivo preferido y revocación

Al materializar:

1. leer `preferred_device_id` del perfil;
2. comprobar device `active`;
3. comprobar grant activo al mismo profile;
4. comprobar `reminders:read` y protocol/capability compatible;
5. crear delivery solo para ese device.

Si falta alguna condición:

- no elegir “el primero activo”;
- no entregar a todos;
- no reciclar un device de otro perfil;
- establecer reminder `awaiting_device`;
- alertar a la UI humana para seleccionar/reautorizar;
- reanudar solo después de una acción humana válida.

Revocar un device cancela deliveries pendientes de ese target y evita nuevas
acciones. Las occurrences completadas no cambian. Una reasignación futura crea
nueva revisión y supersede el delivery anterior.

## Posposición

`snoozed` es una acción global sobre occurrence:

1. bloquear occurrence;
2. validar expected version y duración permitida;
3. incrementar `revision`, `version` y `snooze_count`;
4. actualizar `scheduled_for_utc`;
5. superseder deliveries anteriores;
6. crear delivery con nueva revisión para el target válido;
7. insertar event idempotente;
8. commit único.

Dos posposiciones concurrentes no crean dos alarmas: una gana y la otra recibe
`version_conflict` con estado autoritativo.

## Reconciliación

Responsabilidades del subproceso de reconciliación eventual:

- expirar deliveries fuera de ventana;
- superseder deliveries de revisiones antiguas;
- cancelar targets revocados;
- detectar reminder activo sin próxima occurrence;
- detectar occurrence sin delivery y clasificar la causa;
- reprogramar después de cambio explícito de zona o regla;
- aplicar pruning según retención aprobada;
- reconciliar outbox recibido mediante endpoints, nunca leyendo SQLite device.

WorkManager en Klinip One podrá solicitar config/inbox y drenar outbox, pero no se
presenta como scheduler exacto.

## Métricas propuestas

Solo etiquetas de baja cardinalidad y sin contenido:

- `reminder_job_cycles_total{result}`;
- `reminder_job_duration_ms`;
- `reminder_job_lock_skips_total`;
- `reminder_materialized_total{frequency}`;
- `reminder_due_total`;
- `reminder_expired_total{reason}`;
- `reminder_awaiting_device_total{reason}`;
- `reminder_duplicate_prevented_total{constraint}`;
- `reminder_action_conflicts_total{action}`;
- `reminder_scheduler_lag_seconds`;
- `reminder_backlog_count{state}`;
- `reminder_delivery_age_seconds{state}`;

No usar reminder ID, profile ID, device ID ni title como label de métricas.

## Logs y auditoría

Logs de ciclo permitidos:

- nombre de job;
- duración;
- filas examinadas/materializadas/expiradas;
- lock skip;
- deadline alcanzado;
- error class y reason code allowlisted.

No registrar contenido, nombres, regla completa, zona vinculada a una persona,
tokens, payloads, SQL ni stack traces con parámetros en producción.

Auditoría persistente registra actor `worker`, public IDs saneados, transición,
versión y timestamp, sin contenido.

## Alertas iniciales propuestas

Las alertas no se activan hasta obtener una línea base en staging:

| Señal | Umbral inicial para validar |
|---|---|
| Worker sin ciclo exitoso | Más de 3 intervalos |
| Lag de materialización | p95 mayor a 120 segundos |
| Backlog | Crecimiento durante 5 ciclos consecutivos |
| Error rate | Mayor a 1% del lote, mínimo 5 errores |
| Lock skips | Más de 5 ciclos consecutivos |
| Awaiting device | Aumento inesperado después de revocación/rollout |
| Duplicate prevented | Cualquier aumento sostenido fuera de pruebas |

Estos valores son recomendaciones iniciales, no SLO aprobados.

## Pruebas futuras

### Unitarias

- cálculo one-time, diario y semanal;
- logical occurrence key;
- DST gap/fold con fixtures compartidos;
- catch-up one-time y recurrente;
- preferred device y grants;
- límites de batch/deadline;
- métricas sin datos sensibles.

### Integración PostgreSQL

- dos transacciones materializan una sola occurrence;
- dos deliveries compiten y una unique constraint gana;
- advisory lock no adquirido omite el job;
- caída antes/después del commit;
- `SKIP LOCKED` con varios lotes;
- edición concurrente y schedule version;
- snooze concurrente;
- revocación durante materialización;
- un solo Alembic head.

SQLite se usa para tests funcionales básicos, no para afirmar seguridad de locks
PostgreSQL.

## Rollout y rollback

Orden de activación futuro:

1. esquema aditivo;
2. API con flags apagadas;
3. worker registrado pero job deshabilitado;
4. cuenta y device de prueba revocables;
5. materialización solo para perfil allowlisted;
6. verificación de métricas, duplicados y cleanup;
7. autorización explícita antes de ampliar.

Rollback:

- deshabilitar creación y luego materialización por configuración oficial;
- mantener lectura/acciones para drenar occurrences ya aceptadas;
- no editar filas ni PostgreSQL manualmente;
- no ejecutar downgrade destructivo;
- conservar evidencia saneada para diagnóstico;
- revocar y limpiar credenciales de prueba al finalizar.

## Riesgos y validaciones pendientes

- tolerancia final de atraso Cloud;
- batch y cycle budget medidos;
- tzdb compartida entre Cloud/Flutter;
- proceso Android eliminado y reinicio;
- AlarmManager exact/inexact y restricciones EMUI;
- TTS con pantalla bloqueada;
- consumo 24/72 horas;
- política definitiva de privacidad y retención;
- integración después de cerrar y entregar v0.7.6.
