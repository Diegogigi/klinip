# ADR-005: Tiempo, creación offline y política multidispositivo

- STATUS: **PROPOSED — NOT IMPLEMENTED**
- Fecha: 2026-07-31
- Depende de: ADR-003 y ADR-004

## Contexto

Una recurrencia civil, un draft creado sin conexión y varios dispositivos pueden
producir resultados distintos aunque compartan el mismo texto. Estas reglas deben
ser deterministas antes de crear modelos o contratos.

## Decisión 1 propuesta: zona horaria y DST

### Autoridad temporal

- `HealthProfile.timezone_iana` será la zona autoritativa del perfil.
- `User.timezone` podrá sugerirse solo si es IANA válida y el usuario la confirma.
- Un offset o abreviación como `UTC-03:00` o `CLST` nunca sustituye una zona IANA.
- Sin zona válida, la creación se detiene y pide ciudad/zona.
- Cada definición guarda hora civil original, zona IANA, política DST y UTC de la
  próxima ocurrencia.

### Modos de programación

`wall_clock`:

- mantiene una hora civil fija en la zona original;
- es el único modo recurrente de v0.7.7;
- diario/semanal puede tener intervalos UTC de 23, 24 o 25 horas por DST.

`absolute_interval`:

- mantiene una duración exacta desde el instante anterior;
- puede desplazarse en la hora civil después de DST;
- queda fuera de la primera versión y requerirá selección explícita futura.

Una recurrencia nunca se representa como suma de 24 horas si la intención es “a
las 08:00 todos los días”.

### Hora inexistente

Se aplica `shift_forward_by_gap`: conservar minutos y desplazar por el tamaño del
salto. En `America/Santiago`, el 6 de septiembre de 2026 las 00:30 no existen; el
recordatorio se ejecuta a la 01:30 y la confirmación lo comunica.

### Hora ambigua

Se usa la primera ocurrencia, `fold=0`, y nunca se dispara dos veces. En Santiago,
el 4 de abril de 2026 las 23:30 ocurren dos veces; se elige 23:30 con offset -03,
equivalente a 02:30 UTC del 5 de abril.

### Recordatorio único

Un one-time se resuelve al confirmar:

- si la hora es válida, se guarda su UTC;
- si es inexistente, se muestra la hora desplazada antes de crear;
- si es ambigua, se muestra offset/zona y se usa la primera salvo que el usuario
  elija expresamente la segunda;
- cambios posteriores de tzdb no mueven silenciosamente el instante ya aceptado.

### Viajes y dispositivos en otra zona

El recordatorio permanece anclado a la zona original. El dispositivo muestra:

- hora original del recordatorio;
- hora local convertida si es diferente.

Viajar no cambia el schedule. El usuario puede editar y elegir entre:

- mantener el instante UTC;
- mantener la hora civil y reanclar a otra zona.

Para recurrencias, cambiar la zona afecta solo ocurrencias futuras y crea una nueva
versión. Las ya materializadas se superseden transaccionalmente.

### Recurrencia semanal

Se calcula cada fecha civil en la zona original y después se convierte a UTC. No
se suma una semana absoluta al UTC anterior.

## Decisión 2 propuesta: creación offline como draft no activo

Klinip One podrá capturar una solicitud sin red, pero no afirmará que existe un
recordatorio programado.

Flujo elegido:

1. Parsear localmente y pedir los slots faltantes.
2. Repetir fecha absoluta, hora, zona y recurrencia.
3. Tras “sí”, guardar un draft local cifrado con estado `pending_sync`.
4. Responder: “Guardé un borrador pendiente. Lo programaré cuando vuelva la
   conexión.”
5. No crear alarma ni decir “recordatorio guardado”.
6. Al reconectar, enviar con idempotencia y esperar aceptación Cloud.
7. Solo entonces programar localmente y confirmar “Listo, quedó programado”.

### Identidad e idempotencia

- `local_draft_id`: UUIDv7 aleatorio;
- idempotency key aleatoria, estable y persistida con el draft;
- mapping local entre draft y `reminder_id` Cloud;
- reintentar usa la misma key y payload fingerprint;
- una respuesta perdida no crea duplicados.

### Edición, cancelación y conflictos

- editar antes de sincronizar cambia el draft y su fingerprint, no crea otro;
- cancelar elimina el draft y registra un tombstone local breve;
- si Cloud rechaza zona, permiso o dispositivo, pasa a `requires_attention`;
- si la fecha ocurre antes de reconectar, no se crea retroactivamente: pasa a
  `expired_unsynced` y pide una nueva fecha;
- si el perfil o dispositivo fue revocado, se elimina el draft mediante
  crypto-shredding;
- nunca se fusionan silenciosamente dos drafts parecidos.

Se rechazan inicialmente las alternativas de crear un recordatorio local
autoritativo o programarlo antes de Cloud. Ambas producen divergencia, duplicados
y una falsa garantía en varios dispositivos.

## Decisión 3 propuesta: un dispositivo preferido por recordatorio

La primera versión no entrega automáticamente a todos ni selecciona “el primero
activo”. Cada recordatorio tiene un target determinista.

### Selección

- creado por voz en Klinip One: target predeterminado es ese dispositivo;
- creado en web: usar el dispositivo preferido del perfil;
- si no hay preferido o está revocado, pedir selección;
- “todos los dispositivos” queda fuera de la primera versión;
- cambiar target crea una nueva versión para ocurrencias futuras.

### Estados

- `Reminder`: definición lógica global;
- `ReminderOccurrence`: ejecución global de esa definición;
- `ReminderDelivery`: intento por dispositivo y revisión;
- `ReminderAction`: acción global aceptada con actor y versión.

Aunque inicialmente haya un target, se conserva `ReminderDelivery` por dispositivo
para permitir reasignación y evolución futura sin rehacer el dominio.

### Acciones globales sobre la ocurrencia

- completar en un dispositivo completa la ocurrencia global;
- posponer (`snooze`) es global, incrementa revisión y supersede la entrega
  anterior;
- repetir es una acción local de presentación y no cambia la ocurrencia;
- descartar termina la ocurrencia, no la definición recurrente;
- cancelar la definición requiere confirmación explícita;
- primera acción terminal válida gana mediante optimistic version;
- repetición idempotente del mismo `client_event_id` devuelve el mismo resultado;
- acción concurrente diferente devuelve conflicto y estado autoritativo.

### Revocación y reasignación

- revocar cancela entregas pendientes a ese dispositivo;
- no se reasigna silenciosamente;
- el recordatorio queda `awaiting_device` hasta que una persona elija otro target;
- una reasignación supersede delivery anterior y crea una revisión nueva;
- un dispositivo offline puede conservar ciphertext, pero pierde capacidad de
  actuar y se limpia al siguiente inicio/contacto.

### Dispositivos en zonas distintas

El target no cambia la zona del recordatorio. Cada dispositivo presenta la zona
original y su conversión local. Las acciones usan occurrence ID/version, no la
hora mostrada, para evitar mezclar instancias.

## Ejemplos de aceptación temporal

| Caso | Resultado |
|---|---|
| Único 2026-09-06 00:30 Santiago | Confirmar desplazamiento a 01:30 |
| Diario 00:30 Santiago | Solo el día del salto se ejecuta 01:30; después vuelve 00:30 |
| Semanal sábado 23:30 en retroceso | Primera 23:30, una sola ocurrencia |
| Viaje Santiago → Madrid | Mantiene hora Santiago y muestra conversión Madrid |
| Device en otra zona | No recalcula schedule; solo cambia display |
| Perfil sin zona | Bloquea creación y solicita zona IANA |
| Cambio de zona del perfil | No altera existentes sin edición explícita |
| Absolute interval | No disponible en v0.7.7 |

Los ejemplos se verificaron con Python `zoneinfo` y tzdata 2025.3. Deben
recalcularse en tests con la tzdb incluida en cada build; las leyes de horario de
verano pueden cambiar.

Referencia: [Python zoneinfo e IANA](https://docs.python.org/3/library/zoneinfo.html).

## Consecuencias

### Positivas

- No hay doble disparo ni deriva por DST.
- Viajar no cambia silenciosamente rutinas.
- Offline conserva la intención sin prometer una alarma inexistente.
- Un target evita audio duplicado y carreras difíciles de explicar.
- El modelo sigue preparado para múltiples deliveries futuras.

### Costos y riesgos

- Se requiere una zona IANA real en Cloud y Klinip One.
- El usuario debe confirmar ajustes por DST y cambios de zona.
- Un draft offline puede vencer sin llegar a programarse.
- La reasignación por revocación requiere acción humana.
- La tzdb debe actualizarse y probarse como dependencia operativa.

## Naturaleza de las afirmaciones

- **Decisión arquitectónica propuesta:** wall-clock con zona IANA, draft offline
  no activo, dispositivo preferido y acciones globales sobre la ocurrencia.
- **Supuesto:** Cloud y Klinip One podrán compartir tzdb, versionado e idempotencia
  sin divergencias; requiere prototipos y tests de contrato.
- **Validación pendiente:** DST real, viaje, reconexión, expiración, revocación y
  concurrencia entre dispositivos.

Los ejemplos calculados con `zoneinfo` son evidencia documental, no validación
física ni prueba de una implementación inexistente.

## Validaciones antes de implementar

- cálculo con tzdb real de Chile y otras zonas;
- fold y gap en backend y Flutter con fixtures compartidos;
- viaje, cambio manual de zona y cambio de reloj;
- draft offline, respuesta perdida y reintento idempotente;
- draft vencido antes de reconectar;
- dos dispositivos, revocación y acciones simultáneas;
- copy verbal que diferencia borrador de recordatorio programado.

## Estado de implementación

Esta ADR no autoriza modelos, APIs, parser de voz, almacenamiento, alarmas,
notificaciones, cambios Klinip One, Cloud, Railway ni PostgreSQL.
