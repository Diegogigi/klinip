# ADR-003: Dominio y entrega de recordatorios personales

- Estado: **PROPOSED — NOT IMPLEMENTED**
- Fecha: 2026-07-31
- Alcance: Klinip Cloud y Klinip One v0.7.7
- Tipo: arquitectura de dominio, sincronización, permisos y experiencia conversacional

## Contexto

Klinip necesita recordatorios personales no clínicos que puedan crearse desde la
web o mediante voz, entregarse de forma confiable a Klinip One y permitir acciones
explícitas como completar, posponer, repetir o cancelar.

El sistema actual no contiene un dominio de recordatorios personales. Los campos
`ProfileNote.reminder_at` y `ProfileNote.reminder_sent` implementan una notificación
puntual asociada a una nota, sin recurrencia, estados de ocurrencia, selección de
dispositivo, entrega local ni acciones posteriores. Los modelos de citas,
medicamentos y tareas clínicas no deben reutilizarse porque pertenecen a otro
contexto y mezclarían información clínica con recordatorios personales.

Klinip Cloud ya aporta patrones reutilizables:

- autenticación humana y de dispositivo estrictamente separadas;
- credenciales de dispositivo revocables y scopes explícitos;
- runtime de workers con advisory locks, límites y logs saneados;
- cursores firmados, idempotencia, persistencia de eventos y estados por
  dispositivo en Family Messaging;
- UI accesible, responsive y con temas claro y oscuro.

Klinip One aporta:

- sincronización transaccional antes de emitir confirmaciones al servidor;
- cursores locales y outbox recuperable;
- un único reconocedor de voz y ventanas contextuales breves;
- TTS con detección de finalización e interrupción;
- políticas de privacidad, descanso, horario activo y ciclo de vida;
- almacenamiento local SQLite y credenciales seguras.

Estos componentes son referencias y mecanismos reutilizables. Un recordatorio no
es un mensaje familiar y no debe modelarse como `DeviceMessage`.

## Decisión

### 1. Bounded context independiente

Se creará un bounded context `reminders` separado de:

- Family Messaging;
- citas y medicamentos;
- notas de perfil;
- historial clínico;
- proactividad genérica de Home Experience.

El tipo inicial será `personal_non_clinical`. La primera versión no interpretará
ni ejecutará instrucciones clínicas.

### 2. Modelo de dominio

El modelo mínimo tendrá cuatro conceptos persistentes.

#### Reminder

Define la intención estable del usuario:

- identificador público opaco;
- `health_profile_id`;
- título y detalle opcional;
- origen: `web`, `voice` o `authorized_caregiver`;
- actor creador humano o dispositivo;
- zona horaria IANA original;
- fecha/hora local original;
- regla de recurrencia versionada;
- siguiente ocurrencia UTC;
- alcance de dispositivos;
- estado, versión y timestamps;
- expiración opcional.

#### ReminderOccurrence

Representa una ejecución concreta:

- `reminder_id`;
- instante UTC programado original;
- instante UTC vigente, que puede cambiar por posposición;
- número de revisión y de posposiciones;
- estado y timestamps;
- restricción única sobre la identidad lógica de la ocurrencia.

#### ReminderDelivery

Representa la entrega de una ocurrencia a un dispositivo:

- `occurrence_id` y `device_id`;
- revisión de entrega;
- estado de entrega;
- intentos y timestamps;
- restricción única por ocurrencia, dispositivo y revisión.

#### ReminderEvent

Registro inmutable e idempotente de entregas y acciones:

- `client_event_id` y fingerprint;
- recordatorio, ocurrencia, entrega y actor;
- acción tipada;
- estado resultante;
- timestamp del cliente y timestamp autoritativo del servidor;
- metadatos técnicos mínimos y saneados.

No se guardarán audio ni transcripciones como parte del recordatorio.

### 3. Máquinas de estado separadas

La definición, la ocurrencia y la entrega tendrán estados distintos.

`Reminder`:

- `active`;
- `completed` para recordatorios de una sola vez;
- `cancelled`;
- `expired`;
- `failed`.

`ReminderOccurrence`:

- `scheduled`;
- `due`;
- `snoozed`;
- `completed`;
- `dismissed`;
- `cancelled`;
- `expired`;
- `failed`.

`ReminderDelivery`:

- `queued`;
- `delivered`;
- `announced`;
- `superseded`;
- `failed`;
- `expired`;
- `cancelled`.

Reglas semánticas:

- descargar no cambia ningún estado remoto;
- `delivered` se emite solo después del commit local;
- `announced` se emite solo cuando el TTS termina por completo;
- un TTS interrumpido no genera `announced`;
- escuchar no equivale a completar;
- completar, posponer, descartar y cancelar requieren acciones explícitas;
- `acknowledged` no se reutiliza en recordatorios.

### 4. Tiempo y zona horaria

La zona horaria del recordatorio será un identificador IANA válido, por ejemplo
`America/Santiago`. Se almacenarán simultáneamente:

- instante UTC calculado;
- zona IANA original;
- fecha y hora civil originales;
- regla de recurrencia civil.

La recurrencia permanece anclada a la zona original. Viajar o cambiar la zona del
dispositivo no cambia silenciosamente el horario. La UI puede mostrar también la
conversión local del dispositivo.

`User.timezone` solo podrá usarse como fallback validado. Se recomienda agregar
una zona horaria IANA explícita al perfil. El resolver actual de Klinip One, que
devuelve abreviación y offset, no es suficiente para recurrencia ni cambios de
horario estacional.

Política propuesta para DST:

- hora civil inexistente: mover al primer instante válido posterior y comunicarlo;
- hora civil ambigua: usar la primera ocurrencia (`fold=0`) y conservar la decisión;
- zona ausente o inválida: bloquear creación y solicitar aclaración;
- nunca sustituir silenciosamente por un offset fijo.

### 5. Recurrencia inicial

La primera versión soportará:

- una sola vez;
- todos los días;
- días seleccionados de la semana.

Se usará una regla tipada y versionada, no una cadena RRULE libre:

```json
{
  "version": 1,
  "frequency": "weekly",
  "interval": 1,
  "weekdays": [1, 3, 5],
  "local_time": "09:00"
}
```

Frecuencias mensuales, excepciones complejas y calendarios clínicos quedan fuera.
El contrato podrá incorporar un adaptador RRULE en una versión posterior.

### 6. Materialización y scheduler

Klinip Cloud materializará ocurrencias mediante un job dedicado del runtime
existente. El job será retry-safe porque cada escritura será idempotente.

Controles obligatorios:

- advisory lock por job;
- selección transaccional con bloqueo de filas o `SKIP LOCKED`;
- restricciones únicas para impedir ocurrencias y entregas duplicadas;
- actualización de la próxima ocurrencia en la misma transacción;
- idempotency keys en eventos y acciones;
- sin endpoint manual de ejecución en producción.

Las ocurrencias se materializarán con una ventana corta anticipada, propuesta en
dos minutos, para que Klinip One pueda persistirlas y esperar localmente el
instante exacto. La consulta no usará una ventana inferior estrecha que pierda
recordatorios tras una caída.

Política propuesta de recuperación:

- recuperar ocurrencias perdidas durante las últimas 24 horas;
- expirar ocurrencias más antiguas;
- para recurrencias, colapsar backlog y no reproducir una ráfaga histórica;
- registrar de forma saneada la causa de expiración o recuperación.

### 7. Entrega a Klinip One

Klinip One tendrá almacenamiento, cursor y outbox exclusivos para recordatorios.
El orden obligatorio será:

```text
DESCARGAR
→ VALIDAR
→ PERSISTIR LOCALMENTE
→ COMMIT LOCAL
→ ENVIAR DELIVERED
```

Si falla la persistencia, no se avanza el cursor ni se envía `delivered`.

La descarga del inbox será side-effect-free. Los eventos y acciones se enviarán
por endpoints explícitos. El outbox será reintentable, idempotente y recuperable
tras reinicios.

### 8. Varios dispositivos

El valor por defecto será un dispositivo seleccionado, preferentemente el que
creó el recordatorio, para evitar anuncios simultáneos. Entregar a todos los
dispositivos requerirá una elección explícita.

La primera acción terminal aceptada por el servidor cierra la ocurrencia y marca
las demás entregas como `superseded`. Posponer crea una nueva revisión de la
ocurrencia y nuevas entregas; las anteriores quedan superseded.

### 9. Contratos de API propuestos

Endpoints humanos, protegidos por autenticación humana:

- `POST /api/v1/health-profiles/{profile_id}/reminders`;
- `GET /api/v1/health-profiles/{profile_id}/reminders`;
- `GET /api/v1/health-profiles/{profile_id}/reminders/{reminder_id}`;
- `PATCH /api/v1/health-profiles/{profile_id}/reminders/{reminder_id}`;
- acción explícita de cancelación;
- consulta paginada de ocurrencias y eventos auditables.

Endpoints de dispositivo, protegidos únicamente por credencial de dispositivo:

- `GET /api/v1/device/reminders`;
- `POST /api/v1/device/reminder-deliveries/{delivery_id}/events`;
- `POST /api/v1/device/reminder-occurrences/{occurrence_id}/actions`;
- `POST /api/v1/device/reminders` para creación estructurada por voz.

Un token humano será rechazado por endpoints de dispositivo y un token de
dispositivo será rechazado por endpoints humanos.

### 10. Permisos y scopes

Permisos humanos propuestos:

- `view_reminders`;
- `create_reminders`;
- `edit_reminders`;
- `cancel_reminders`;
- `complete_reminders`.

El propietario y administrador tendrán permisos explícitos. Caregiver solo los
tendrá si fueron concedidos. Viewer podrá recibir únicamente `view_reminders` si
se autoriza. No se reutilizarán permisos de mensajes, citas o medicamentos.

Scopes de dispositivo propuestos:

- `reminders:read`;
- `reminders:act`;
- `reminders:create`.

La revocación de dispositivo o permiso impedirá nuevas descargas y acciones.

### 11. Voz y continuidad conversacional

La creación por voz producirá un `ReminderDraft` estructurado. Klinip One no
enviará audio ni transcripción cruda a Cloud. El flujo resolverá slots de forma
determinista:

- contenido;
- fecha;
- hora;
- zona horaria;
- recurrencia;
- dispositivo objetivo.

Antes de crear, Klinip repetirá fecha absoluta, hora, zona y recurrencia y pedirá
confirmación explícita. Una ambigüedad abre una pregunta corta; no se adivina.

Al anunciar un recordatorio se admitirán respuestas contextuales breves como
`completado`, `recuérdamelo después`, `repítelo` y `cancela`. La ventana comienza
después del TTS, expira, usa un solo recognizer y respeta privacidad, descanso y
ciclo de vida. No se habilita conversación abierta permanente.

La integración con v0.7.6 se limitará a interfaces conversacionales genéricas y
estables. v0.7.7 no modificará ni asumirá detalles internos de esa iteración.

### 12. Política de anuncio y ciclo de vida

La sincronización y persistencia pueden continuar sin anunciar. El TTS y el
micrófono quedan bloqueados por:

- modo privado;
- RestMode;
- ciclo de vida no activo;
- horario inactivo.

Un recordatorio debido no utilizará el cooldown genérico de proactividad. Si está
fuera del horario activo, quedará pendiente localmente y se anunciará en la
primera ventana permitida. No habrá override de urgencia en v0.7.7.

La garantía inicial de anuncio puntual aplica con Klinip One en primer plano y en
modo de uso dedicado. Con el proceso terminado o suspendido, Flutter no puede
garantizar audio exacto sin un mecanismo nativo de wake-up. Push silencioso,
WorkManager o foreground service requieren una decisión posterior de batería,
privacidad y plataforma; no se asumirán en el MVP.

### 13. Privacidad y observabilidad

No se registrarán en logs:

- título o detalle del recordatorio;
- nombres de personas;
- audio o transcripción;
- tokens, credenciales o coordenadas;
- contenido clínico.

Los logs contendrán solo identificadores saneados, acción, transición, latencia,
intento y resultado. La auditoría persistente guardará actor, acción y timestamps,
sin duplicar contenido.

El almacenamiento local de contenido se limitará a lo necesario para anunciar y
operar offline. El cifrado local y la retención deben resolverse antes de declarar
la función lista para producción.

## Consecuencias

### Positivas

- Semántica explícita y auditable sin contaminar Family Messaging.
- Entrega idempotente y recuperable ante reinicios y redes inestables.
- Recurrencia correcta frente a zona horaria y DST.
- Separación real de autenticación humana y de dispositivo.
- Experiencia accesible y conversacional sin escucha permanente.
- Base extensible para web, voz y varios dispositivos.

### Costos y riesgos

- Nuevas tablas, contratos, almacenamiento local y pruebas de integración.
- La entrega exacta con la app terminada requiere infraestructura nativa adicional.
- Las reglas de DST, viaje, catch-up y varios dispositivos deben comunicarse bien.
- Guardar contenido local sin cifrado añade riesgo residual.
- La creación offline necesita una política explícita de reconciliación.

## Alternativas descartadas

### Reutilizar ProfileNote.reminder_at

Descartado por falta de recurrencia, estados, ocurrencias, dispositivos y acciones.

### Reutilizar DeviceMessage

Descartado porque un recordatorio es una intención programada y recurrente, no un
mensaje enviado por un familiar. Sus estados y permisos son diferentes.

### Reutilizar citas o medicamentos

Descartado para mantener separados los contextos personal y clínico.

### Usar solo offsets UTC

Descartado porque falla con horario estacional, viajes y recurrencia civil.

### Marcar delivered al descargar

Descartado porque podría confirmar una entrega que nunca quedó persistida.

### Mantener escucha permanente

Descartado por privacidad, consumo, doble recognizer y ambigüedad conversacional.

## Decisiones pendientes antes de implementar

1. Garantía requerida cuando Klinip One está cerrado y canal nativo permitido.
2. Retención de recordatorios, ocurrencias, eventos y contenido local.
3. Cifrado del contenido local en SQLite.
4. Política final de DST ambiguo e inexistente.
5. Duración y límites de posposición.
6. Creación por voz offline: bloquear o usar creación provisional con outbox.
7. Dispositivo objetivo por defecto cuando hay varios vinculados.
8. Política de contenido que parezca clínico.
9. Permisos por defecto para caregiver y viewer.

## Criterio de aceptación de esta ADR

Esta ADR aprueba únicamente el diseño para discusión. No autoriza migraciones,
endpoints, workers, UI, cambios en Klinip One, despliegues ni datos productivos.
