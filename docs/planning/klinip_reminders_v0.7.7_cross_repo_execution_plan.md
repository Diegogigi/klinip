# Klinip v0.7.7: plan de ejecución entre repositorios

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Fecha: 2026-08-02
- Klinip Cloud: `C:\Users\hp\Desktop\Klinip`
- Klinip One: repositorio separado, solo mediante handoff
- Contrato: [Cloud y dispositivo](../contracts/reminders_cloud_device_contract_v0.7.7.md)
- Esquema: [schema y migraciones](klinip_reminders_v0.7.7_schema_and_migrations.md)
- Runtime: [scheduler y worker](klinip_reminders_v0.7.7_scheduler_worker.md)

## Objetivo

Preparar PR pequeños y verificables sin comenzar la implementación. Este plan no
autoriza commits, push, migraciones, endpoints, despliegues ni modificaciones en
Klinip One. v0.7.6 continúa bajo responsabilidad de Claude Code.

## Límites de propiedad

### Codex: Klinip Cloud

- bounded context y modelos Cloud;
- migraciones Alembic;
- servicio de recurrencia y persistencia;
- autenticación y permisos humanos;
- scopes y endpoints de dispositivo;
- scheduler/worker;
- UI web;
- tests backend/frontend;
- observabilidad, rollout y documentación Cloud.

### Claude Code: Klinip One

- modelos y SQLite locales;
- cifrado y lifecycle de claves;
- connector, cursor y polling;
- persist-before-delivered;
- outbox de eventos/acciones;
- draft offline;
- AlarmManager, receiver, boot y WorkManager;
- notificación Android y TTS;
- conversación/acciones por voz;
- integración con interfaces públicas de v0.7.6;
- pruebas físicas Huawei.

### Regla de coordinación

Ningún agente modifica el repositorio del otro. La coordinación usa:

- este contrato versionado;
- fixtures JSON ficticios;
- OpenAPI/JSON Schema generados en una fase futura;
- fake server y fake connector;
- documento de handoff con commit, versión y cambios compatibles.

Una modificación contractual exige actualizar documentación y fixtures antes de
código consumidor. No se coordinan cambios copiando archivos entre worktrees.

## Dependencias obligatorias

| Orden | Entregable | Desbloquea |
|---:|---|---|
| 1 | Contratos documentales aprobados | Modelos y fakes |
| 2 | Estados, recurrence fixtures y schema Cloud | Migraciones |
| 3 | Migraciones aditivas con flags apagadas | Servicios Cloud |
| 4 | API humana/device con separación de tokens | Connector fake/real |
| 5 | Scheduler idempotente y tests PostgreSQL | Delivery integrado |
| 6 | Suite Cloud completa | Handoff estable a Klinip One |
| 7 | Connector One contra fake | Integración local Cloud/One |
| 8 | UI web accesible | Flujo humano E2E |
| 9 | Integración local completa | Pruebas físicas |
| 10 | Huawei, privacidad y batería | Rollout controlado |
| 11 | Autorización explícita | Despliegue/activación |

Claude puede desarrollar persistencia y connector contra fixtures después del
contrato aprobado, pero Android/TTS debe esperar las validaciones y el handoff de
v0.7.6. Codex no debe asumir interfaces internas de esa rama.

## Fases Cloud propuestas

### Dominio

- entidades, enums y máquinas de estado separadas;
- recurrence parser estructural, sin lenguaje natural;
- zona IANA y logical occurrence key;
- servicios de permisos e idempotencia;
- auditoría saneada;
- feature flag por componente.

### Persistencia

- tablas y constraints del schema propuesto;
- una sola línea Alembic;
- migration tests fresh/upgrade/downgrade lógico;
- ningún backfill desde notas, citas, medicamentos o mensajes;
- datos de prueba ficticios y revocables.

### API

- endpoints humanos con `get_current_user`;
- endpoints device con `DevicePrincipal`;
- scopes nuevos sin auto-concesión;
- cursor firmado para inbox;
- idempotencia y optimistic version;
- rate limits y errores estables;
- OpenAPI sin indicar funciones no activadas.

### Scheduler

- job retry-safe que se registraría en el worker existente;
- advisory lock, row locks y constraints;
- horizonte, catch-up, backlog y revocación;
- métricas de baja cardinalidad;
- job deshabilitado hasta autorización.

### UI web

- portada con `Crear`, `Próximos` y `Completados`;
- wizard por pasos y resumen civil;
- detalle, edición y cancelación;
- permisos y estados vacíos/error/loading;
- paridad claro/oscuro;
- densidad compacta móvil;
- copy UTF-8 sin términos técnicos.

## Fases Klinip One propuestas para handoff

### Persistencia local

- tablas separadas de Family Messaging;
- contenido cifrado por campo;
- página y cursor en una transacción;
- no `delivered` antes del commit;
- cleanup y retención local.

### Connector

- config y capability negotiation;
- inbox side-effect-free;
- outbox causal e idempotente;
- refresh/revocación antes de sync;
- errores retryable/no-retryable según contrato.

### Runtime Android

- AlarmManager como scheduler local propuesto;
- WorkManager solo para reconciliación;
- boot/time/timezone receivers;
- notificación privada;
- foreground service corto únicamente si se valida;
- cero promesa de TTS bloqueado antes de Huawei.

### Conversación

- anuncio después de TTS completo;
- acciones breves después de TTS, sin barge-in;
- un recognizer;
- expiración, privacidad, RestMode y lifecycle;
- draft estructurado y confirmación explícita;
- ninguna transcripción cruda enviada a Cloud.

## Plan de PR Cloud

La base de cada PR será el merge anterior de esta cadena, no una rama discovery.

### PR A: dominio y migraciones

- Base: `main` actualizado.
- Alcance: entidades, estados, recurrence value objects, tablas, constraints y
  migración aditiva; flags apagadas.
- Dependencias: contrato/schema aprobados.
- Pruebas: enums/transiciones, Alembic fresh/upgrade, constraints, dos workers a
  nivel de persistencia y un solo head.
- Riesgos: migración parcial, DST, cifrado y relaciones profile/device.
- Merge: revisión de seguridad, cero endpoint activo y suite completa verde.
- Rollback: flag apagada; no downgrade destructivo en producción.

### PR B: API, permisos y scopes

- Base: PR A fusionado.
- Alcance: servicios, schemas, rutas humanas/device, cursores, idempotencia,
  catálogo de permisos/scopes y auditoría.
- Dependencias: tablas y contratos estables.
- Pruebas: rechazo cruzado de tokens, roles, scopes, perfil equivocado,
  idempotency conflict, cursor, revocación y rate limit.
- Riesgos: auto-conceder scopes o filtrar existencia de otro perfil.
- Merge: OpenAPI revisado, feature flag apagada y pruebas negativas completas.
- Rollback: desactivar rutas por flag; conservar tablas.

### PR C: scheduler y worker

- Base: PR B fusionado.
- Alcance: job, materializador, due/catch-up, preferred device, locks, métricas y
  reconciliación; job deshabilitado.
- Dependencias: API no es requisito de ejecución, pero comparte dominio estable.
- Pruebas: PostgreSQL concurrente, caída/commit incierto, backlog, revocación,
  snooze/version y deadline.
- Riesgos: duplicados, starvation del worker y ráfagas históricas.
- Merge: constraints demuestran unicidad y no se ejecutan jobs manuales.
- Rollback: deshabilitar registro/config; no tocar filas manualmente.

### PR D: frontend web

- Base: PR B fusionado; puede avanzar en paralelo con C tras congelar API.
- Alcance: navegación, wizard, listas, detalle, edición y cancelación.
- Dependencias: API fake/OpenAPI estable.
- Pruebas: componentes, integración, permisos, errores, teclado, screen reader,
  tema claro/oscuro, viewport móvil y copy UTF-8.
- Riesgos: mostrar IDs/estados técnicos y demasiada densidad para adulto mayor.
- Merge: revisión visual local aprobada en ambos temas y móvil.
- Rollback: feature flag y retiro de navegación.

### PR E: observabilidad y preparación de rollout

- Base: PR C y D fusionados.
- Alcance: dashboards/config/alerts saneados, runbook, cleanup y flags; sin
  activación productiva.
- Dependencias: nombres finales de métricas y flujo E2E local.
- Pruebas: redacción de logs, ausencia de cardinalidad alta, flags y rollback.
- Riesgos: contenido sensible en telemetría o activación accidental.
- Merge: secret scan, checklist de privacidad y aprobación operativa.
- Rollback: retirar alertas/config nuevas sin eliminar evidencia.

## Plan de PR Klinip One

Los PR F..J son propiedad de Claude Code y requieren un handoff separado.

### PR F: modelos y persistencia local

- Base: rama estable posterior a v0.7.6.
- Alcance: modelos, SQLite, cifrado, cursor transaccional y retención.
- Dependencias: contrato/fixtures y decisión de claves.
- Pruebas: migración local, corrupción, pérdida de clave, persist failure y wipe.
- Riesgos: pérdida de drafts, backup de ciphertext y tamaño de DB.
- Merge: no red, no Android scheduler y tests locales verdes.
- Rollback: feature flag; preservar DB para migración forward segura.

### PR G: connector y outbox

- Base: PR F fusionado.
- Alcance: config, inbox, cursor, outbox y fake transport.
- Dependencias: API B o fake contractual equivalente.
- Pruebas: persist-before-delivered, HTTP perdido, duplicados, cursor ajeno,
  revocación y orden causal.
- Riesgos: avanzar cursor prematuramente o doble outbox.
- Merge: comparación fixture Cloud/One y cero evento en GET.
- Rollback: detener polling y conservar outbox.

### PR H: Android scheduling/background

- Base: PR G fusionado.
- Alcance: AlarmManager, receiver, boot, clock/timezone y WorkManager de
  reconciliación; notificación privada.
- Dependencias: validaciones descartables de APIs/OEM y permisos.
- Pruebas: emulador/API levels y matriz Huawei pendiente.
- Riesgos: batería, force-stop, EMUI, exact alarm y lifecycle.
- Merge: no afirmar TTS bloqueado; feature flag local apagada.
- Rollback: cancelar alarms/work y volver a foreground-only.

### PR I: conversación y UX

- Base: PR G más handoff estable de v0.7.6; H solo si requiere background.
- Alcance: TTS, contexto de acciones, draft y confirmación.
- Dependencias: interfaces públicas de sesión/TTS/recognizer.
- Pruebas: TTS interrumpido, contexto expira, privado, RestMode, no doble
  recognizer, acciones y payload estructurado.
- Riesgos: conversación fragmentada, barge-in o mezclar occurrences.
- Merge: suite Flutter y revisión conversacional controlada.
- Rollback: desactivar voz y conservar UI/acciones manuales.

### PR J: validación física y cierre

- Base: F..I integrados sin producción.
- Alcance: documentación, checklist Huawei, evidencia saneada y cleanup.
- Dependencias: cuenta/device de prueba revocables.
- Pruebas: matriz física completa, batería, reinicio, offline y privacidad.
- Riesgos: afirmar capacidades no observadas o dejar credenciales activas.
- Merge: aprobación humana explícita y limpieza comprobada.
- Rollback: revocar device, cancelar alarms y eliminar datos de prueba.

## Orden de integración y PR

```text
Documentos aprobados
  → A Dominio/migraciones
  → B API/permisos
  → C Scheduler/worker
  → D Frontend (puede partir tras B)
  → E Observabilidad
  → Handoff Cloud estable
  → F Persistencia One
  → G Connector/outbox
  → H Android runtime
  → I Conversación
  → Integración local
  → J Huawei/cleanup
  → Autorización de rollout
```

No se fusionan PR dependientes con contrato cambiante. No se despliega una rama
para “probar rápido” sin autorización.

## Fixtures contractuales ficticios

Los IDs usan prefijos de demo y nunca representan usuarios reales.

| Fixture | Definición | Resultado esperado |
|---|---|---|
| `once_future_v1` | Una vez, fecha futura, `Etc/UTC` | Una occurrence y un delivery |
| `daily_santiago_v1` | Diario 08:30, `America/Santiago` | Fechas civiles estables |
| `weekly_demo_v1` | Lunes/miércoles/viernes 19:00 | Solo weekdays seleccionados |
| `offline_draft_v1` | Draft cifrado sin aceptación Cloud | No Reminder ni alarma activa |
| `expired_once_v1` | One-time fuera de catch-up | Expired, sin anuncio |
| `cancelled_definition_v1` | Reminder cancelado antes de due | Sin delivery nuevo |
| `snoozed_occurrence_v1` | Snooze 10 minutos, version 2 | Delivery revisión 2; anterior superseded |
| `two_devices_v1` | Dos grants, uno preferido | Solo preferred recibe delivery |
| `dst_gap_santiago_v1` | Hora inexistente en Chile | Shift forward por gap |
| `dst_fold_santiago_v1` | Hora ambigua en Chile | Fold temprano, una occurrence |
| `revoked_device_v1` | Preferred revocado | Awaiting device, sin reasignar |
| `duplicate_event_v1` | Mismo client event/fingerprint | Duplicate true, un event |
| `event_conflict_v1` | Mismo client event, payload distinto | 409 conflict |

Cada fixture debe existir en JSON canónico compartido, con schema version, input,
expected output y timestamps fijos. No incluir nombre, correo, dirección,
coordenadas, token ni texto clínico.

## Matriz de integración extremo a extremo

| Caso | Web | Cloud/API | Scheduler | Delivery | Klinip One | TTS/acción | Estado web |
|---|---|---|---|---|---|---|---|
| One-time normal | Crear y confirmar | 201 idempotente | Una occurrence | Inbox side-effect-free | Commit y delivered | Announced + completed | Completado |
| Recurrente diario | Resumen civil | Guarda IANA | Materializa horizonte | Una revisión | Programa local | Completa solo occurrence | Definición activa |
| Semanal | Selecciona días | Valida weekdays | Fechas civiles correctas | Target preferido | Persiste próximas | Acción sobre actual | Próxima fecha visible |
| Red antes de commit | Sin cambio | Inbox repetible | Sin duplicar | Mismo cursor | Falla persistencia | No delivered | Pendiente |
| Red después de commit | Sin cambio | Evento idempotente | Sin efecto | Delivery existente | Outbox pendiente | Reintenta | Entregado una vez |
| TTS interrumpido | Sin cambio | Sin announced | Sin efecto | Delivered | Conserva selección | No acción automática | Pendiente |
| Snooze | Muestra nueva hora | Version lock | Nueva revisión | Anterior superseded | Reprograma | Snoozed explícito | Pospuesto |
| Dos dispositivos | Muestra preferido | Verifica grants | Un target | Un delivery | Solo preferido | Acción global | Estado único |
| Device revocado | Solicita selección | 401/awaiting | No reasigna | Cancela pendiente | Wipe al contacto | No TTS | Requiere dispositivo |
| DST gap/fold | Explica ajuste | Conserva IANA | Logical key única | UTC resuelto | Muestra civil | Una acción | Sin duplicado |
| Cancelación | Confirma | Transición auditable | No futuras | Cancelled | Reconciliación | No anuncio | Cancelado |
| Offline draft | No aplica | Aún no existe | No materializa | Ninguno | Draft cifrado | Confirma pendiente | Aparece tras sync |

## Criterios de aceptación global

- una definición no clínica nunca se almacena como note/appointment/medication;
- una occurrence y delivery sobreviven a retries sin duplicarse;
- inbox repetido no cambia estado;
- persist failure no genera `delivered` ni avanza cursor;
- TTS completo genera `announced`; interrupción no;
- completar, posponer y descartar son acciones explícitas globales;
- token humano/device se rechaza en el dominio opuesto;
- scopes nuevos no se auto-conceden;
- zona IANA y DST producen fixtures iguales en Cloud/One;
- logs, métricas y auditoría no exponen contenido;
- frontend cumple claro/oscuro, móvil compacto, accesibilidad y copy íntegro;
- toda credencial y dato de prueba se elimina/revoca después de validación;
- rollout requiere autorización posterior.

## Handoff mínimo Cloud → Klinip One

El handoff futuro debe incluir:

- commit y PR Cloud fusionados;
- OpenAPI/JSON Schemas versionados;
- fixtures y hashes canónicos;
- lista de endpoints realmente disponibles;
- scopes y pairing requeridos;
- matriz de errores y retry policy;
- fake server reproducible;
- feature flags y entorno local;
- cambios desde la versión contractual anterior;
- prohibición explícita de producción.

Claude confirma por separado la versión de v0.7.6 y las interfaces públicas que
v0.7.7 puede consumir.

## Decisiones no cerradas

- TTS con pantalla bloqueada;
- comportamiento con proceso eliminado y force-stop;
- restricciones Huawei/EMUI;
- exact alarm permission en Android aplicable;
- consumo de batería 24/72 horas;
- hardware backing real de Keystore;
- estrategia de claves Cloud;
- valores definitivos de retención;
- política final de privacidad;
- límites de snooze y catch-up;
- integración posterior al cierre de v0.7.6.

No se inventan resultados ni se bloquea la validación física actual para resolver
estas decisiones.

## Condición de salida de readiness

Esta etapa termina con documentación local sin commit, push ni PR. La futura
implementación requiere autorización explícita, branch/worktree nuevos por
repositorio y revisión del diff antes de cada publicación.
