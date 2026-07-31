# Klinip v0.7.7: plan de recordatorios personales y entrega

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Fecha: 2026-07-31
- ADR: [ADR-003](../decisions/ADR-003-reminders-domain-and-delivery.md)
- Repositorio de trabajo: Klinip Cloud
- Referencia comparativa: Klinip One

## Objetivo

Definir una implementación incremental y verificable para crear recordatorios
personales no clínicos, programarlos en Klinip Cloud, entregarlos a Klinip One y
permitir acciones explícitas mediante UI y voz.

Este documento no implementa modelos, migraciones, endpoints, scheduler, UI ni
integración móvil.

## Repositorios auditados

| Repositorio | Ruta auditada | Rama/base auditada | Uso en discovery |
|---|---|---|---|
| Klinip Cloud | `C:\Users\hp\Desktop\Klinip` | `main` / `8352796` | Dominio, worker, API, permisos, web |
| Klinip One | `C:\Users\hp\Desktop\Klinip_One_v0.6_integration` | `integration/v0.6-living-presence-family` / `90d5a5e` | Sync local, outbox, TTS, voz y políticas |
| Discovery v0.7.6 | worktree separado, solo lectura | commit de discovery `2d83967` | Dependencias conversacionales futuras |

El trabajo documental v0.7.7 vive en el worktree
`C:\Users\hp\Desktop\Klinip_v0.7.7_reminders_discovery`, rama
`discovery/v0.7.7-reminders`, creado desde `8352796`.

## Hallazgos de Klinip Cloud

### Componentes reutilizables

| Componente | Reutilización propuesta |
|---|---|
| Worker runtime | Ciclos acotados, deadlines, advisory locks y métricas saneadas |
| Job registry | Registrar materialización de ocurrencias como job propio |
| Device Identity | Credenciales revocables, grants y separación humano/dispositivo |
| Device Messaging | Patrón de cursores, idempotencia, eventos explícitos y múltiples dispositivos |
| Permission catalog | Agregar permisos propios de recordatorios |
| Frontend Klinip One | Patrones de portada simple, wizard, accesibilidad, temas y móvil compacto |
| Test fixtures | Autenticación, perfiles, dispositivos, workers y aislamiento multiusuario |

### Brechas

- `ProfileNote.reminder_at` y `reminder_sent` no constituyen un dominio.
- No existe `Reminder`, ocurrencia, entrega ni evento de recordatorio.
- El job de notas usa una ventana temporal estrecha y puede perder ejecuciones.
- No hay recurrencia ni política explícita de DST.
- `HealthProfile` no posee una zona IANA autoritativa.
- No existen permisos ni scopes específicos de recordatorios.
- No existen endpoints humanos o de dispositivo para el dominio.
- No existe UI web de creación, agenda o historial de recordatorios.
- No hay política de varios dispositivos ni recuperación de backlog.

## Hallazgos de Klinip One

### Componentes reutilizables

| Componente | Reutilización propuesta |
|---|---|
| Cloud connector | Polling acotado, autenticación y recuperación de red |
| Message sync | Orden persistir/commit/delivered y cursor firmado |
| SQLite repositories | Transacciones locales, outbox y recuperación tras reinicio |
| Conversation context | Respuestas breves sin nuevo wake word |
| TTS lifecycle | Emitir `announced` solo tras finalización real |
| ActiveHoursPolicy | Posponer anuncios fuera del horario permitido |
| Privacy y RestMode | Bloquear TTS y micrófono sin perder el recordatorio |
| Lifecycle | Cancelar escucha y reanudar catch-up de forma segura |

### Brechas

- No hay repositorio local, cursor ni outbox de recordatorios.
- No hay timer local para esperar el instante programado.
- La zona actual es una abreviación con offset, no un identificador IANA.
- No hay parser de `ReminderDraft` ni confirmación estructurada por voz.
- No hay UX de anuncio, posposición, repetición, completado o cancelación.
- El polling solo en foreground no garantiza anuncio con la app terminada.
- SQLite almacena contenido de aplicación sin una decisión de cifrado específica.

## Límites del dominio

### Incluido

- recordatorios personales no clínicos;
- creación web;
- creación por voz estructurada;
- una sola vez, diario y días de semana seleccionados;
- entrega a uno o varios dispositivos elegidos;
- completar, posponer, repetir, descartar y cancelar;
- persistencia offline de acciones con outbox;
- recuperación tras reinicio y caída breve del worker;
- auditoría saneada.

### Fuera de alcance

- citas, medicamentos, adherencia y decisiones clínicas;
- Family Messaging y permisos familiares nuevos;
- WhatsApp, correo o SMS;
- visión, AEC e interrupción por voz durante TTS;
- conversación abierta permanente;
- recurrencia mensual o reglas RRULE arbitrarias;
- prioridad clínica o urgencia que ignore privacidad/descanso;
- cambios de producción, Railway o PostgreSQL durante discovery;
- implementación o modificación de v0.7.6.

## Contrato conceptual

### ReminderCreateRequest

```json
{
  "title": "Regar las plantas",
  "body": null,
  "local_date": "2026-08-02",
  "local_time": "19:00",
  "timezone": "America/Santiago",
  "recurrence": {
    "version": 1,
    "frequency": "weekly",
    "interval": 1,
    "weekdays": [2, 5],
    "local_time": "19:00"
  },
  "target": {
    "mode": "selected_devices",
    "device_ids": ["opaque-device-id"]
  },
  "idempotency_key": "client-generated-key"
}
```

La API valida permisos, propiedad del perfil, zona IANA, fecha civil, regla y
dispositivos vinculados antes de persistir.

### DeviceReminderInboxItem

```json
{
  "delivery_id": "opaque-delivery-id",
  "occurrence_id": "opaque-occurrence-id",
  "reminder_id": "opaque-reminder-id",
  "title": "Regar las plantas",
  "body": null,
  "scheduled_for": "2026-08-02T23:00:00Z",
  "timezone": "America/Santiago",
  "local_label": "domingo 2 de agosto, 19:00",
  "revision": 1,
  "expires_at": "2026-08-03T23:00:00Z"
}
```

La respuesta no cambia estado. El cursor se firma y se vincula a dispositivo,
perfil y dominio `reminders`.

### ReminderActionRequest

```json
{
  "client_event_id": "uuid",
  "action": "snoozed",
  "expected_version": 3,
  "occurred_at": "2026-08-02T23:00:10Z",
  "parameters": {
    "duration_minutes": 10
  }
}
```

El servidor valida actor, scope, dispositivo destinatario, versión, transición e
idempotencia. Devuelve `accepted`, estado y versión autoritativos.

## Flujo de entrega

1. El scheduler materializa una ocurrencia y sus entregas de manera idempotente.
2. Klinip One descarga el inbox sin efectos secundarios.
3. Valida esquema, identidad, expiración, revisión y límites.
4. Persiste toda la página y el cursor en una transacción SQLite.
5. Después del commit crea `delivered` en su outbox.
6. El outbox envía el evento con idempotencia y confirma la aceptación.
7. El timer local espera `scheduled_for`.
8. Las políticas deciden si se puede anunciar.
9. TTS completo crea `announced`; TTS interrumpido no lo crea.
10. Una acción explícita crea `completed`, `snoozed`, `dismissed` o `cancelled`.
11. El servidor resuelve carreras y supersede entregas de otros dispositivos.

## Política temporal

### Autoridad

- Cloud calcula ocurrencias desde hora civil y zona IANA.
- UTC es la referencia de intercambio y orden.
- La zona IANA original conserva intención y recurrencia.
- El dispositivo usa hora monotónica para timers cortos y detecta cambios de reloj.
- La respuesta Cloud puede aportar hora de servidor para estimar desfase.

### DST y viajes

- Hora inexistente: desplazar al primer instante válido posterior y mostrar aviso.
- Hora ambigua: primera ocurrencia, registrada de forma determinista.
- Viaje: no cambia la recurrencia; se muestran zona original y conversión local.
- Cambio intencional: editar el recordatorio crea una nueva versión futura.

### Worker caído

- Escanear desde el último watermark confirmado, no solo `now - grace`.
- Catch-up propuesto: 24 horas.
- Ocurrencias más antiguas expiran con razón auditable.
- Recurrencias no reproducen todos los eventos atrasados; se conserva el último
  elegible y se calcula el próximo.

## Scheduler e idempotencia

El job propuesto `materialize_reminder_occurrences` debe:

1. adquirir advisory lock del runtime;
2. seleccionar definiciones activas vencidas mediante lock de fila;
3. calcular la ocurrencia con librería IANA probada;
4. insertar ocurrencia mediante restricción única;
5. insertar entregas mediante restricción única;
6. actualizar `next_occurrence_at` y versión;
7. confirmar en una sola transacción;
8. exponer solo métricas agregadas y logs saneados.

La duplicación se previene en dos niveles: exclusión operativa mediante locks y
corrección persistente mediante constraints/idempotency keys. El diseño no depende
solo de que exista una réplica del worker.

## Permisos

### Matriz humana propuesta

| Rol | Ver | Crear | Editar | Cancelar | Completar |
|---|---:|---:|---:|---:|---:|
| Owner | Sí | Sí | Sí | Sí | Sí |
| Admin | Sí | Sí | Sí | Sí | Sí |
| Caregiver | Solo explícito | Solo explícito | Solo explícito | Solo explícito | Solo explícito |
| Viewer | Solo explícito | No | No | No | No |
| Professional futuro | No por defecto | No | No | No | No |

Los endpoints humanos verifican permiso y acceso al perfil en cada operación.

### Matriz de dispositivo

| Scope | Capacidad |
|---|---|
| `reminders:read` | Descargar entregas destinadas al dispositivo |
| `reminders:act` | Reportar entrega y acciones sobre sus ocurrencias |
| `reminders:create` | Crear un draft confirmado mediante voz |

Un scope no concede acceso a otros perfiles o dispositivos. La revocación invalida
token y grants de inmediato.

## UX web propuesta

Crear una sección independiente `Recordatorios`, no una pestaña de mensajes.

Portada con tres acciones grandes:

- `Crear recordatorio`;
- `Próximos`;
- `Completados`.

Wizard de creación:

1. Qué recordar.
2. Cuándo.
3. Repetición.
4. Dispositivo.
5. Revisión y confirmación.

La revisión debe expresar una frase humana completa: “Klinip te recordará regar
las plantas los martes y viernes a las 19:00, hora de Santiago”.

Requisitos de implementación futura:

- controles táctiles de al menos 48 px;
- navegación por teclado y labels accesibles;
- contenido compacto en móvil sin perder legibilidad;
- temas claro y oscuro equivalentes;
- estados vacíos, carga, error y permisos insuficientes;
- no mostrar UUID, RRULE, scopes, cursores ni estados internos;
- aplicar `ui-theme-parity`, `mobile-compact-ui` y `ui-copy-integrity`.

## UX de Klinip One propuesta

Anuncio base:

> “Tienes un recordatorio: regar las plantas.”

Después del TTS se abre una ventana contextual breve:

- “Listo” o “ya lo hice” → completar;
- “en diez minutos” → posponer;
- “repítelo” → repetir sin completar;
- “descártalo” → descartar esta ocurrencia;
- “cancela este recordatorio” → confirmar cancelación de la definición.

La cancelación completa requiere confirmación explícita. “Después” sin duración
debe preguntar cuánto tiempo. La ventana se cierra al responder, expira y nunca
crea un segundo recognizer.

Modo privado, descanso, lifecycle y horario activo bloquean el anuncio y la
escucha contextual. El recordatorio permanece pendiente. No se usa el cooldown
genérico de proactividad para retrasar una ocurrencia debida.

## Creación por voz

Ejemplo:

1. Usuario: “Recuérdame regar las plantas mañana a las siete.”
2. Klinip resuelve fecha absoluta, hora y zona del perfil.
3. Klinip: “Te recordaré regar las plantas mañana, sábado 1 de agosto, a las
   19:00, hora de Santiago. ¿Lo guardo?”
4. Solo un “sí” contextual crea el recordatorio.
5. Klinip confirma con la fecha absoluta y el dispositivo objetivo.

Reglas:

- no enviar audio ni transcripción cruda a Cloud;
- normalizar localmente a un draft estructurado;
- pedir slots faltantes o ambiguos;
- no convertir contenido clínico en un recordatorio personal sin aclaración;
- usar idempotency key para evitar doble creación;
- no afirmar que se guardó antes de recibir aceptación del servidor.

## Privacidad, retención y auditoría

### Datos permitidos

- título y detalle estrictamente necesarios;
- definición temporal y zona IANA;
- dispositivos objetivo;
- estados y acciones;
- actor y timestamps para auditoría.

### Datos prohibidos en logs

- contenido del recordatorio;
- audio y transcripciones;
- nombre del usuario;
- dirección o coordenadas;
- token o credencial;
- datos clínicos.

### Decisiones pendientes

- cifrado local del contenido;
- retención de completados y cancelados;
- eliminación del contenido tras expiración;
- exportación y borrado por solicitud del titular.

## Casos límite

| Caso | Comportamiento esperado |
|---|---|
| Worker reinicia | Reanuda desde watermark y no duplica ocurrencias |
| Dos workers | Lock + constraints producen una sola ocurrencia |
| Red cae tras commit local | `delivered` queda en outbox y se reintenta |
| Red cae antes del commit | No cursor y no `delivered` |
| Respuesta HTTP perdida | Reintento idempotente devuelve mismo resultado |
| TTS interrumpido | No `announced`; conserva ocurrencia pendiente |
| Modo privado | Persiste, pero no habla ni abre micrófono |
| RestMode | Posponer anuncio hasta reactivación permitida |
| Fuera de horario activo | Anunciar en la próxima ventana activa |
| App en background | No asumir audio; catch-up seguro al volver |
| App terminada | No garantía sin canal nativo aprobado |
| Cambio manual de reloj | Recalcular timer desde UTC/hora de servidor |
| Viaje de zona | Mantener zona original y mostrar conversión |
| DST inexistente | Desplazar y comunicar |
| DST ambiguo | Usar fold configurado de forma determinista |
| Dos dispositivos anuncian | Primera acción terminal cierra y supersede la otra |
| Posposición simultánea | Control optimista acepta una sola revisión |
| Recordatorio editado ya descargado | Nueva revisión supersede la anterior |
| Dispositivo revocado | Rechazar sync/acción; no reasignar silenciosamente |
| Permiso humano retirado | Rechazar siguientes operaciones |
| Contenido vacío o enorme | Validación de longitud y error accesible |
| Frase temporal ambigua | Preguntar; nunca adivinar |
| Contenido aparentemente clínico | Bloquear o solicitar reformulación no clínica |

## Matriz de pruebas

### Backend unitarias

- validación de regla de recurrencia;
- cálculo one-time, diario y semanal;
- DST inexistente y ambiguo;
- cambio de año y fin de mes;
- cálculo de próxima ocurrencia;
- máquina de estados y transiciones inválidas;
- permisos por rol;
- scopes y separación de tokens;
- saneamiento de logs.

### Backend integración

- creación humana idempotente;
- token de dispositivo rechazado por endpoint humano;
- token humano rechazado por endpoint de dispositivo;
- inbox side-effect-free tras varias descargas;
- persistencia única con dos workers;
- materialización tras caída y catch-up;
- cursor ligado a dispositivo y dominio;
- acción duplicada aceptada una sola vez;
- carrera de acciones entre dispositivos;
- revocación de credencial y permiso;
- expiración y cancelación;
- edición supersede entregas antiguas.

### Frontend

- wizard completo con teclado;
- validación y resumen temporal;
- permisos insuficientes;
- lista próximos/completados;
- cancelar y editar;
- loading/error/empty;
- tema claro y oscuro;
- viewport móvil compacto;
- copy sin términos técnicos ni datos internos.

### Flutter unitarias

- validación de payload;
- transacción de página y cursor;
- no `delivered` si persistir falla;
- outbox, reintentos y respuesta perdida;
- timer local y cambio de reloj;
- políticas privado/descanso/horario/lifecycle;
- TTS completo crea `announced`;
- interrupción no crea `announced`;
- parser de draft y slots ambiguos;
- contexto expira y no crea doble recognizer;
- acciones completado/posposición/repetición/cancelación;
- no mezclar ocurrencias o dispositivos.

### End-to-end y físicas

- crear en web y recibir en Huawei P30 Pro;
- crear por voz y verificar resumen antes de guardar;
- una sola vez en primer plano;
- recurrencia diaria/semanal;
- red intermitente antes y después del commit;
- reinicio de Klinip One con outbox pendiente;
- modo privado, RestMode y horario inactivo;
- TTS interrumpido;
- posponer y recibir la nueva revisión;
- dos dispositivos cuando estén físicamente disponibles;
- app en background y terminada, documentando la capacidad real;
- zona horaria y DST con reloj de prueba controlado.

## Plan por fases

### Fase A: decisiones bloqueantes y contratos

**Tamaño:** pequeño.

Entregables:

- aprobar ADR-003;
- resolver preguntas de zona, wake-up, retención, cifrado y offline;
- cerrar esquemas JSON y máquinas de estado;
- definir permisos y scopes;
- crear fixtures contractuales compartidos Cloud/One.

Salida: contratos versionados y ninguna pregunta de seguridad bloqueante.

### Fase B: dominio y scheduler Cloud

**Tamaño:** grande.

Áreas probables:

- modelos y migración Alembic;
- servicio de recurrencia;
- repositorio transaccional;
- job registry/runtime;
- pruebas unitarias e integración.

Riesgos: DST, duplicados, backlog y migración. No se habilita aún en producción.

Salida: materialización determinista e idempotente con worker concurrente.

### Fase C: API, autenticación y permisos Cloud

**Tamaño:** grande.

Entregables:

- endpoints humanos;
- inbox y acciones de dispositivo;
- cursores firmados independientes;
- idempotencia y auditoría;
- permisos humanos y scopes de dispositivo;
- pruebas de separación de tokens y multiusuario.

Salida: contratos backend verdes sin consumidores productivos.

### Fase D: UX web

**Tamaño:** mediano.

Entregables:

- portada y wizard;
- próximas, completadas y detalle;
- edición/cancelación;
- accesibilidad, responsive, temas y copy;
- tests de componentes y build.

Salida: validación visual local y funcional sin desplegar.

### Fase E: persistencia y sincronización Klinip One

**Tamaño:** grande.

Entregables:

- modelos y tablas locales separadas;
- sync transaccional y cursor;
- outbox de eventos/acciones;
- timer local;
- integración de lifecycle y políticas;
- pruebas de fallos y reinicios.

Salida: descarga side-effect-free y orden persistir antes de delivered comprobado.

### Fase F: anuncio, acciones y creación por voz

**Tamaño:** grande.

Dependencia: interfaces genéricas estabilizadas de v0.7.6.

Entregables:

- TTS y estado announced;
- contexto breve de acciones;
- parser y `ReminderDraft`;
- confirmación antes de crear;
- feedback de red y reintento;
- validación física en Huawei P30 Pro.

Salida: conversación acotada, un recognizer y estados remotos consistentes.

### Fase G: rollout controlado

**Tamaño:** mediano.

Entregables:

- feature flags separadas para web, API, worker y One;
- observabilidad saneada;
- canary con cuenta de prueba;
- validación física completa;
- documentación operativa y rollback.

Salida: activación explícita solo tras pruebas, revisión de privacidad y autorización.

## Rollout propuesto

1. Desplegar esquema y API con feature flag desactivada.
2. Desplegar worker sin materializar hasta activar flag de perfil de prueba.
3. Activar UI solo para cuenta de prueba.
4. Instalar Klinip One debug en un dispositivo revocable.
5. Validar creación, entrega, acciones, reinicios y privacidad.
6. Revocar credenciales y limpiar datos de prueba.
7. Revisar métricas de duplicados, latencia, expiración y outbox.
8. Solicitar autorización antes de ampliar acceso.

No se crean servicios, migraciones manuales ni datos productivos durante discovery.

## Rollback

- Desactivar primero creación y materialización mediante feature flags.
- Mantener lectura para drenar acciones ya persistidas, si es seguro.
- Detener el job por configuración oficial, no alterando filas manualmente.
- Klinip One conserva outbox y no declara éxito sin aceptación del servidor.
- La UI oculta creación y presenta estado temporal claro.
- No revertir una migración destructivamente; conservar tablas hasta análisis.
- Revocar credenciales de prueba y eliminar contenido según política aprobada.

## Dependencias con v0.7.6

v0.7.7 solo puede consumir contratos públicos y estabilizados para:

- iniciar una ventana contextual después de TTS;
- resolver una respuesta y cerrar contexto;
- cancelar contexto por privacidad, lifecycle o timeout;
- respetar el único recognizer;
- observar finalización/interrupción de TTS.

No debe:

- modificar el worktree o PR de v0.7.6;
- depender de clases internas no aprobadas;
- ampliar conversación abierta;
- habilitar barge-in;
- asumir que v0.7.6 ya está fusionada.

Si esas interfaces cambian, la Fase F espera un handoff explícito y adapta solo el
módulo v0.7.7.

## Preguntas abiertas y recomendación

1. **App terminada:** aceptar en MVP una garantía de primer plano; evaluar después
   push de wake-up sin contenido.
2. **Zona del perfil:** agregar `HealthProfile.timezone_iana` y usar User solo como
   fallback validado.
3. **Varios dispositivos:** seleccionar uno por defecto; todos solo explícitamente.
4. **Catch-up:** 24 horas y backlog recurrente colapsado.
5. **Posposición:** opciones 10, 30 y 60 minutos más duración verbal explícita;
   definir máximo diario.
6. **Retención:** 90 días para completados/eventos operativos, sujeto a revisión de
   privacidad y requisitos legales.
7. **Creación offline:** inicialmente informar que se necesita conexión; evaluar
   después draft provisional con outbox.
8. **Contenido clínico:** bloquear instrucciones de dosis o tratamiento y dirigirlas
   al flujo clínico futuro.
9. **Caregiver:** ningún permiso de edición por defecto; concesión explícita.
10. **Cifrado local:** resolver antes del rollout productivo.

## Criterios de salida del discovery

- ADR y plan revisados por Cloud y Klinip One.
- Estados y contratos sin ambigüedades.
- Separación humana/dispositivo comprobable por diseño.
- Estrategia idempotente contra duplicados documentada.
- Zona horaria, DST, catch-up y varios dispositivos definidos.
- Limitación de app cerrada comunicada sin promesas falsas.
- Matriz de pruebas, rollout y rollback completos.
- Cero código productivo, migraciones, endpoints o cambios en v0.7.6.
