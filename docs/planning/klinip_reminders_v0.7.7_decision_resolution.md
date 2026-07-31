# Klinip v0.7.7: resolución de decisiones bloqueantes

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Fecha: 2026-07-31
- Base: merge documental del PR #27
- ADRs: [ADR-004](../decisions/ADR-004-reminders-runtime-security-and-retention.md) y [ADR-005](../decisions/ADR-005-reminders-time-offline-and-multidevice-policy.md)

## Propósito

Cerrar las decisiones que podrían obligar a rehacer runtime Android, persistencia,
contratos temporales o estados antes de implementar recordatorios.

No se implementa ninguna capacidad.

## Terminología operativa

- **Notificación Android:** señal visible publicada por el sistema.
- **Anuncio por TTS:** voz reproducida por Klinip One; no se presupone que opere
  con pantalla bloqueada.
- **Scheduler:** mecanismo que determina cuándo vence una ocurrencia.
- **Reconciliación:** verificación posterior con Cloud y reparación eventual de
  estado; no reemplaza al scheduler.
- **Foreground service:** mecanismo excepcional, corto y visible, no servicio
  permanente oculto.

Las políticas siguientes son **decisiones arquitectónicas propuestas**. Las
expectativas basadas en APIs o documentación son **supuestos**. Las pruebas que
faltan se identifican como **validaciones pendientes**. Nada está validado
físicamente en esta iteración.

## Resultado de las seis decisiones

| Decisión | Política propuesta |
|---|---|
| App cerrada/background | Híbrido: AlarmManager + notificación + WorkManager; FGS corto solo como candidato de prueba |
| Cifrado local | AES-256-GCM por campos, claves envueltas por Android Keystore |
| Retención | Contenido corto, metadata/auditoría diferenciada y crypto-shredding |
| DST | Wall-clock IANA; gap hacia adelante; fold temprano; sin doble disparo |
| Creación offline | Draft cifrado no activo; Cloud confirma antes de programar |
| Multidispositivo | Un target preferido; acciones globales y delivery versionado |

## Relación con ADR-003

ADR-003 sigue siendo la definición del dominio. ADR-004 y ADR-005 resuelven sus
preguntas abiertas sin modificarla todavía.

Precisiones nuevas:

- el horizonte de dos minutos mencionado inicialmente no sirve para app cerrada u
  offline; se propone un horizonte rodante configurable de 72 horas;
- `announced` sigue requiriendo TTS completo; una notificación o frase genérica no
  equivale a TTS completo del contenido;
- el modo recurrente inicial es `wall_clock`;
- offline produce un draft, no un Reminder;
- la primera versión selecciona un solo dispositivo target.

Una referencia mínima desde ADR-003 puede añadirse después de aprobar estos ADRs.

## Arquitectura inspeccionada

### Klinip Cloud

- `backend/app/jobs/locking.py`;
- `backend/app/jobs/runtime.py`;
- `backend/app/jobs/registry.py`;
- `backend/app/worker.py`;
- `backend/app/models.py`;
- `backend/app/device_messages/service.py`;
- `backend/app/devices/security.py`;
- helpers temporales y reminder de notas en `backend/app/main.py`;
- pruebas de worker, device identity y mensajes.

Hallazgo: advisory locks, retry control, idempotencia y eventos son reutilizables;
el reminder de notas y el fallback a offset fijo no lo son.

### Klinip One, solo lectura

- `lib/cloud/klinip_cloud_connector.dart`;
- `lib/cloud/messages/device_message_sync_service.dart`;
- `lib/hardware/cloud/sqlite_device_message_repository.dart`;
- `lib/hardware/cloud/flutter_secure_device_session_store.dart`;
- `lib/app/klinip_one_app.dart`;
- `lib/presentation/screens/face_screen.dart`;
- `lib/engines/home/active_hours_policy.dart`;
- `lib/engines/home/proactive_interaction_policy.dart`;
- `lib/engines/voice/voice_engine.dart`;
- `android/app/src/main/AndroidManifest.xml`;
- `android/app/build.gradle.kts`;
- `pubspec.yaml`.

Hallazgo: sync transaccional, outbox, lifecycle y políticas son reutilizables. No
existe runtime Android de background. El repositorio tenía trabajo concurrente de
v0.7.6 y no fue modificado.

## Contratos que deben reservarse

### Scheduling

- `schedule_mode` versionado;
- `timezone_iana`;
- `local_date`, `local_time` y weekdays civiles;
- `dst_gap_policy=shift_forward_by_gap`;
- `dst_fold_policy=earlier`;
- `resolved_scheduled_for_utc`;
- tzdb version usada para cálculo/validación.

### Offline draft

- `local_draft_id`;
- `pending_sync`, `requires_attention`, `expired_unsynced`;
- payload fingerprint e idempotency key estable;
- mapping a reminder ID Cloud solo después de aceptación.

### Delivery target

- `target_mode=selected_device`;
- `target_device_id`;
- occurrence version y delivery revision;
- acción con expected version y `client_event_id`.

### Runtime local

- estado `alarm_scheduled_at` y versión de PendingIntent;
- política visible/dedicada de lock screen;
- key version y crypto schema;
- boot/time/timezone reconciliation markers;
- outbox cifrado y fecha de retención.

## Secuencia futura de implementación

### Fase 0: aprobaciones y prototipos descartables

- aprobar ADR-004 y ADR-005;
- fijar applicationId y signing de Klinip One antes de Keystore;
- validar AlarmManager/EMUI en una app mínima separada;
- validar AES-GCM/Keystore y pérdida de clave;
- aprobar copy y retención con privacidad;
- confirmar handoff estable de v0.7.6.

No se migra código del prototipo sin revisión.

### Fase 1: contratos y fixtures compartidos

- JSON schemas versionados;
- fixtures UTC/IANA/DST;
- máquinas de estado y errores;
- política de target y conflictos;
- test vectors de cifrado sin claves reales.

### Fase 2: Cloud sin activación productiva

- dominio y migraciones;
- worker materializador idempotente;
- endpoints humanos/dispositivo;
- permisos y auditoría;
- feature flags desactivadas.

### Fase 3: storage y runtime Android

- tablas locales separadas;
- cifrado y key lifecycle;
- sync/cursor/outbox;
- AlarmManager, receiver, boot y WorkManager;
- notificación privada; FGS corto solo después de validación física explícita.

### Fase 4: UX web y conversación

- creación web;
- parser y draft offline;
- confirmaciones sin ambigüedad;
- acciones contextualizadas usando interfaces públicas de v0.7.6.

### Fase 5: validación controlada

- cuenta y dispositivo de prueba revocables;
- pruebas físicas Huawei;
- batería y privacidad;
- limpieza de credenciales y contenido;
- autorización explícita antes de despliegue.

## Matriz de validación futura Huawei P30 Pro

| Caso | Evidencia requerida |
|---|---|
| Foreground | Hora programada, TTS y estado remoto |
| Background | Receiver/notificación sin proceso Flutter visible |
| Pantalla bloqueada | Notificación privada y prueba separada de si TTS funciona |
| Doze | Latencia medida de exact/inexact alarm |
| Proceso eliminado | PendingIntent inicia salida mínima |
| Force-stop | No autoarranque y recuperación explicada al abrir |
| Reinicio | Alarmas restauradas después del primer unlock |
| Ahorro batería | Resultado con optimización activa y desactivada |
| EMUI App launch | Auto/secondary/background documentados |
| Modo avión | Ocurrencias locales funcionan; outbox espera |
| Offline >72h | Estado degradado sin inventar ocurrencias |
| Reloj atrasado | Reconciliación sin doble anuncio |
| DST simulado | Gap/fold según ADR-005 |
| Múltiples reminders | Orden estable y sin colisiones de PendingIntent |
| Snooze | Nueva revisión y cancelación de alarma previa |
| Dos dispositivos | Acción global y conflicto autoritativo |
| Revocación | Sin acciones aceptadas y wipe al contacto |
| Limpieza | Clave, DB, alarms, notifications y outbox eliminados |

## Riesgos principales

1. EMUI puede imponer restricciones adicionales a las de AOSP.
2. Force-stop no tiene solución legítima de autoarranque.
3. TTS con pantalla bloqueada no está garantizado y puede exponer información
   personal; permanece deshabilitado hasta validación Huawei.
4. Clave Keystore perdida destruye drafts/acciones no sincronizados.
5. Cambios legales de horario requieren tzdb actualizada.
6. Un horizonte offline finito no cubre desconexión indefinida.
7. FCM no está verificado y no debe convertirse en dependencia oculta.
8. applicationId y firma debug actuales no son base segura de producción.
9. Retención necesita aprobación antes de crear datos reales.
10. Cambios concurrentes de v0.7.6 exigen handoff, no acoplamiento directo.

## Validaciones documentales y técnicas futuras

- tests de contrato Cloud/One;
- test vectors de gap/fold y cambio de tzdb;
- carreras de worker y constraints únicas;
- persist-before-delivered;
- alarm IDs estables y reemplazo por revisión;
- reboot, clock change y timezone change;
- rotación, corrupción y pérdida de clave;
- backup excluido;
- pruning y crypto-shredding;
- offline draft idempotente;
- acciones simultáneas y revocación;
- logs sin contenido, transcript, claves o datos clínicos.

## Decisiones cerradas y aspectos aún sujetos a aprobación

Las seis decisiones arquitectónicas tienen una política propuesta. Antes de
implementar todavía deben aprobarse o verificarse:

- tolerancia exacta de minutos y uso de exact alarms en versiones Android nuevas;
- si cualquier anuncio TTS puede funcionar de forma fiable y privada con pantalla
  bloqueada en Huawei;
- valores de retención 7/30/180/365 días;
- soporte Google FCM, Huawei HMS o ninguno en evolución futura;
- resultado de consultar hardware backing de Keystore en el Huawei real, sin
  asumir que esté disponible;
- package/applicationId y signing definitivos;
- handoff público estable de v0.7.6.

## Fuera de alcance

No iniciar modelos, tablas, migraciones, endpoints, worker, scheduler, frontend,
connector, notificaciones, servicios, push, voz, recordatorios reales, Railway,
PostgreSQL, medicamentos, citas, WhatsApp, visión, música o video.

## Condición de cierre

Este segundo discovery se preserva mediante un único commit documental y un PR
borrador sin merge. La implementación requiere una autorización posterior y
reparto explícito entre Klinip Cloud y Klinip One. El resultado contiene cero
código productivo, cero migraciones y cero cambios de infraestructura o
producción.
