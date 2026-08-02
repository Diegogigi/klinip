# ADR-004: Runtime, seguridad local y retención de recordatorios

- STATUS: **PROPOSED — NOT IMPLEMENTED**
- Fecha: 2026-07-31
- Depende de: ADR-003
- Investigación: [opciones de entrega en background](../research/reminders-background-delivery-options.md)

## Contexto

ADR-003 dejó abiertas tres decisiones capaces de cambiar contratos y persistencia:

1. ejecución con Klinip One cerrado o en background;
2. cifrado local;
3. retención y eliminación.

Klinip One actualmente pausa Cloud polling al salir de foreground, usa SQLite sin
cifrado integral y protege solo la sesión con secure storage. No posee servicios,
alarmas, receivers ni notificaciones nativas para recordatorios.

## Decisión 1: runtime Android híbrido

La entrega futura combinará mecanismos con responsabilidades separadas:

- **Cloud worker:** materializa ocurrencias y entregas idempotentes;
- **foreground sync:** descarga inmediata mientras Klinip One está visible;
- **AlarmManager:** programa el instante local de una ocurrencia ya persistida;
- **notificación local:** señal visible del sistema cuando Flutter no está visible;
- **foreground service corto:** candidato excepcional y visible para evaluar TTS,
  nunca continuo ni oculto;
- **WorkManager:** reconciliación posterior, reprogramación y limpieza eventual;
- **BootReceiver:** reconstruye alarmas después de reinicio y primer unlock;
- **push futuro:** hint opaco de sincronización, nunca scheduler autoritativo.

En esta ADR, el **scheduler** determina cuándo vence una ocurrencia; la
**notificación Android** solo presenta una señal visible; un **anuncio por TTS**
es voz reproducida por Klinip One; y la **reconciliación** verifica después el
estado con Cloud. Son responsabilidades distintas.

### Garantías por estado

- Visible: timer Flutter y TTS normal.
- Background o pantalla apagada: se propone una alarma local para ocurrencias ya
  descargadas; su comportamiento real en Huawei sigue sin validarse.
- Proceso eliminado por Android: receiver nativo puede iniciar el flujo mínimo.
- Reinicio: no hay garantía hasta reprogramar tras boot/primer unlock.
- Offline: solo se garantizan ocurrencias incluidas en el horizonte local.
- Force-stop: no hay autoarranque; la UI debe informar al volver a abrir.

El horizonte inicial propuesto es 72 horas, máximo 100 ocurrencias por dispositivo.
Será configurable y podrá ajustarse sin cambiar el contrato.

### Política audible

Por defecto, la propuesta con pantalla bloqueada se limita a una notificación
privada. No se afirma que TTS funcione con la pantalla bloqueada.

Como experimento posterior, un modo dedicado podría evaluar TTS si:

- el usuario dio consentimiento explícito;
- PrivateMode y RestMode están desactivados;
- la política de horario lo permite;
- el contenido ya está local y descifrado;
- se muestra una notificación de foreground service;
- el servicio no usa micrófono, cámara ni ubicación;
- el servicio termina al finalizar TTS.

Este candidato permanece deshabilitado hasta comprobar inicio, reproducción,
cierre y privacidad en el Huawei P30 Pro. No constituye una garantía
arquitectónica ni una capacidad validada.

No se ejecutará un foreground service continuo. FCM/HMS no se incorpora en la
primera implementación y requerirá una decisión separada de proveedor.

## Decisión 2: cifrado selectivo con Android Keystore

Se propone conservar SQLite privado para índices operativos y cifrar campos
sensibles mediante AES-256-GCM. Una clave de datos versionada sería protegida por
una clave gestionada por Android Keystore.

La presencia de Android Keystore no permite afirmar que la clave sea
hardware-backed. Esa propiedad debe consultarse y verificarse en cada dispositivo;
si no está disponible, el fallback y su nivel de protección deben documentarse.

### Datos cifrados

- título y cuerpo;
- etiqueta humana del creador;
- regla de recurrencia completa y zona original;
- draft de creación offline;
- payload completo de outbox;
- mensajes de error que pudieran incluir contenido.

### Metadatos operativos no cifrados adicionalmente

- identificadores opacos;
- `scheduled_for_utc` y próxima ejecución;
- versión y estado técnico;
- device/profile IDs opacos;
- intentos, timestamps y códigos de error saneados;
- nonce, versión de clave y esquema criptográfico.

La hora UTC queda visible dentro del sandbox porque AlarmManager y las consultas
locales deben operar sin descifrar contenido. No se guardan nombres ni contenido
en índices.

### Envelope y AAD

- algoritmo: `AES/GCM/NoPadding`;
- nonce aleatorio único por escritura;
- AAD: versión de esquema, profile ID, device ID, record ID y nombre de campo;
- clave de datos aleatoria por instalación;
- clave de envoltura en Android Keystore;
- ningún secreto hardcodeado ni derivado de un identificador de dispositivo.

La política de autenticación de la clave se definirá después de las pruebas de
privacidad y lifecycle. La salida inicial con pantalla bloqueada no necesita
descifrar contenido, porque la notificación será genérica. No se promete acceso a
la clave antes del primer unlock después de reinicio.

### Rotación y pérdida

- cada ciphertext incluye `key_version`;
- rotación crea una nueva clave y re-encripta en lotes transaccionales;
- claves antiguas permanecen envueltas hasta completar y verificar la migración;
- si Keystore invalida o pierde la clave, se elimina el cache cifrado y se
  rehidratan recordatorios futuros desde Cloud;
- drafts y acciones nunca sincronizadas pueden perderse y deben informarse;
- desvincular elimina filas, claves envueltas y alias Keystore.

### Backup

La base de recordatorios, claves envueltas y secure storage se excluyen de Auto
Backup y device transfer. Restaurar ciphertext sin su clave debe evitarse. Un nuevo
dispositivo se vincula y descarga desde Cloud.

### Alternativas

| Alternativa | Decisión |
|---|---|
| SQLite privado sin cifrado extra | Rechazado como única defensa |
| Cifrado selectivo + Keystore | Propuesta inicial para v0.7.7 |
| SQLCipher + Keystore | Evaluación futura si se cifra toda la base |
| Clave en SharedPreferences o código | Prohibido |

SQLCipher protege páginas, WAL y journals, pero introduce una implementación
SQLite nativa diferente, migración de toda la base y compatibilidad adicional con
sqflite. No se añadirá hasta medir el riesgo y el costo en Huawei.

## Decisión 3: retención diferenciada propuesta

Los valores siguientes son defaults iniciales sujetos a aprobación de privacidad.

### Cloud

| Dato | Retención propuesta |
|---|---|
| Definición activa/futura | Mientras esté activa o hasta eliminar el perfil |
| Contenido de definición terminal | 30 días desde completar/cancelar/expirar |
| Tombstone de definición | 180 días, sin título ni cuerpo |
| Ocurrencias, entregas y acciones | 180 días desde estado terminal |
| Idempotency fingerprints | 180 días |
| Logs operativos saneados | 30 días |
| Auditoría mínima de seguridad | 365 días o política global más estricta |

Tras 30 días, el contenido humano se redacta; la auditoría conserva solo IDs
opacos, actor, transición, resultado y timestamps.

### Klinip One

| Dato | Retención propuesta |
|---|---|
| Futuras/due/snoozed | Hasta terminal, revocación o fuera del horizonte válido |
| Contenido terminal local | 7 días |
| Tombstones e idempotencia local | 30 días |
| Outbox confirmado | Máximo 24 horas después de aceptación |
| Outbox pendiente/failed | Hasta aceptación o 30 días; luego requiere atención |
| Draft offline | 30 días o 7 días después de su fecha, lo que ocurra primero |
| Logs locales saneados | Ring buffer de 7 días |

### Derechos y limpieza

- El usuario puede cancelar y borrar contenido humano inmediatamente.
- Borrar no elimina antes de tiempo el tombstone mínimo necesario para impedir
  replay o duplicados, pero ese tombstone no contiene texto.
- Revocar un dispositivo cancela entregas futuras y ordena crypto-shredding local.
- Un dispositivo offline no puede borrarse remotamente de inmediato; al abrir o
  reconectar, token inválido fuerza wipe. La revocación de la clave vuelve
  ilegible el contenido local.
- Eliminar un perfil bloquea acceso de inmediato, cancela recordatorios y programa
  borrado de contenido dentro de 30 días, sujeto a obligaciones aplicables.
- Los recordatorios no se incorporan a historial clínico, AI profile, citas,
  medicamentos ni resúmenes médicos.

## Consecuencias

### Positivas

- La hora puede dispararse sin servicio permanente.
- El contenido queda protegido incluso si se extrae la base SQLite.
- La retención no convierte rutinas personales en historial clínico permanente.
- La pérdida de red no rompe recordatorios ya predescargados.
- Force-stop y restricciones OEM se comunican sin promesas falsas.

### Costos y riesgos

- Se requiere una capa Android nativa nueva y pruebas por versión.
- La política audible necesita consentimiento y espejo nativo de modos silenciosos.
- Pérdida de Keystore elimina drafts no sincronizados.
- El cifrado de campos exige migración versionada y pruebas de corrupción.
- Los valores de retención necesitan aprobación formal antes de producción.

## Naturaleza de las afirmaciones

- **Decisión arquitectónica propuesta:** híbrido Android, cifrado por campos y
  retención diferenciada.
- **Supuesto:** las APIs y restricciones descritas se comportarán según la
  documentación oficial en el dispositivo objetivo.
- **Validación pendiente:** toda prueba Huawei/EMUI, TTS bloqueado, consumo,
  hardware backing y aprobación de retención.

Ninguna decisión de esta ADR se presenta como implementada o validada físicamente.

## Validaciones obligatorias antes de implementar

- exact alarms en Android 10/EMUI;
- reinicio, first unlock y rescheduling;
- foreground service corto y TTS con pantalla bloqueada, sin asumir soporte;
- force-stop y recuperación visible;
- consulta de hardware backing de Keystore y fallback documentado;
- rotación, clave perdida, desvinculación y restore;
- batería durante 24/72 horas;
- aprobación de privacidad para retención y audio en lock screen.

## Estado de implementación

Esta ADR no autoriza código, dependencias, manifest, migraciones, servicios,
notificaciones, push, cambios Cloud, Railway ni PostgreSQL.
