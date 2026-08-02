# Recordatorios v0.7.7: opciones de entrega en background

- Estado: **RESEARCH — NOT IMPLEMENTED**
- Fecha: 2026-07-31
- Alcance: Android y Klinip One
- Dispositivo de referencia: Huawei P30 Pro con Android 10

## Objetivo

Comparar mecanismos reales para entregar recordatorios cuando Klinip One está
visible, en background, con pantalla apagada, sin proceso, después de un reinicio,
bajo restricciones de batería o sin conexión.

Este documento no afirma que estas capacidades existan en Klinip One. No añade
dependencias, permisos, receivers, servicios ni notificaciones.

## Terminología y nivel de certeza

- **Notificación Android:** señal visible publicada por el sistema. No implica
  que Klinip One haya reproducido voz.
- **Anuncio por TTS:** voz reproducida por Klinip One. Su ejecución con pantalla
  bloqueada no está garantizada y queda pendiente de validación física en Huawei.
- **Scheduler:** mecanismo que determina cuándo vence una ocurrencia. Una
  notificación presenta la señal, pero no sustituye al scheduler.
- **Reconciliación:** verificación posterior con Cloud para corregir estado,
  reprogramar y sincronizar acciones; no determina por sí sola la hora exacta.
- **Foreground service:** mecanismo excepcional, corto y visible mediante una
  notificación obligatoria. No se propone como servicio permanente u oculto.

Las afirmaciones de este documento se clasifican así:

- **Decisión arquitectónica propuesta:** dirección inicial todavía no
  implementada ni validada físicamente.
- **Supuesto:** conclusión basada en documentación oficial o inspección del
  repositorio que debe comprobarse en el entorno real.
- **Validación pendiente:** prueba necesaria antes de aprobar implementación o
  prometer comportamiento en Huawei/EMUI.

## Capacidades verificadas en el repositorio

La inspección de Klinip One confirma:

- `KlinipCloudConnector` usa polling acotado y solo mientras `_foreground` es
  verdadero;
- `KlinipOneApp` pausa el connector en `inactive`, `paused`, `detached` y
  `hidden`;
- la persistencia actual usa `sqflite` sin cifrado integral;
- la sesión de dispositivo se guarda con `flutter_secure_storage`;
- el inbox de mensajes persiste antes de generar `delivered`;
- no hay integración con AlarmManager, WorkManager, FCM o HMS Push;
- no hay foreground service ni receiver de reinicio;
- el manifest no declara permisos de alarmas, boot, foreground service o
  notificaciones;
- modo privado, RestMode, lifecycle y horario activo ya existen como políticas
  de aplicación.

Por tanto, la versión actual no puede garantizar un recordatorio si Flutter está
en background o el proceso no está activo.

## Restricciones oficiales relevantes

- AlarmManager puede disparar un `PendingIntent` fuera del ciclo de vida de la
  aplicación y con el dispositivo dormido. Los reinicios eliminan alarmas y se
  requiere `RECEIVE_BOOT_COMPLETED` más un receiver para reprogramarlas.
- Doze difiere red, jobs y alarmas estándar. `setExactAndAllowWhileIdle()` puede
  atravesar Doze para una acción puntual solicitada por el usuario.
- WorkManager es persistente y reintentable, pero no es un reloj exacto. El
  trabajo periódico tiene granularidad mínima de 15 minutos y puede ser diferido.
- Un foreground service debe presentar una notificación visible y se reserva para
  trabajo perceptible por el usuario. Desde Android 12 hay restricciones para
  iniciarlo desde background, aunque una alarma exacta solicitada por el usuario
  es una excepción documentada.
- Un paquete detenido explícitamente por el usuario no puede autoarrancarse hasta
  que una acción explícita lo saque del estado stopped.
- FCM de prioridad alta intenta despertar el dispositivo, pero puede ser
  degradado y debe producir una notificación visible. No es garantía de entrega
  exacta ni funciona offline.
- Huawei documenta controles adicionales de EMUI para auto-launch, secondary
  launch, ejecución en background, optimización de batería y bloqueo en recientes.

## Estados operativos

| Estado | Capacidad actual | Capacidad de la estrategia propuesta |
|---|---|---|
| App visible | Polling y timers Flutter | Timer Flutter más alarma nativa de respaldo |
| Background | Connector pausado | Alarma local preprogramada; sin polling continuo |
| Pantalla apagada | Sin garantía | `RTC_WAKEUP` y política compatible con Doze |
| Proceso eliminado por Android | Sin garantía | PendingIntent puede iniciar receiver nativo |
| Force-stop del usuario | Sin garantía | Sin garantía por diseño Android; requiere abrir la app |
| Reinicio | Sin reprogramación | BootReceiver reconstruye alarmas después del primer unlock |
| Batería restringida | No validado | Degradación visible más guía EMUI y prueba física |
| Offline | Sin nuevos datos | Funcionan solo ocurrencias ya persistidas y programadas |

## Matriz de alternativas

### Resumen comparativo de background

| Alternativa | Ventajas | Riesgos | Compatibilidad | Privacidad | Consumo | Confiabilidad | Complejidad | Recomendación inicial | Validación pendiente |
|---|---|---|---|---|---|---|---|---|---|
| Polling foreground | Ya existe y es observable | No opera con app cerrada | Actual en Flutter/Huawei | No despierta ni habla solo | Bajo fuera de la app; medio visible | Baja para recordatorios | Baja | Conservar para sync visible, no como scheduler | Lifecycle y frases lentas sin regresión |
| FGS continuo | Mantiene proceso activo | Restricciones OEM, force-stop y notificación permanente | Posible en Android 10 con permisos | Mantiene más estado activo y señal visible | Alto | Media, no inmune a OEM | Alta | Rechazado | No aplica como diseño elegido |
| AlarmManager | Programa ocurrencias locales one-shot | Reinicio, force-stop, Doze y EMUI | API Android 10; reglas cambian en versiones nuevas | Depende de la salida al disparar | Bajo con pocas alarmas | Alta como base local, no absoluta | Media | Scheduler principal del híbrido | Exactitud, reinicio, Doze y EMUI reales |
| WorkManager | Persistente y reintentable | El sistema puede diferirlo | AndroidX/Android 10 | Payload local mínimo | Bajo/medio según frecuencia | Alta para trabajo eventual, no exacto | Media | Reconciliación, limpieza y sync | Latencia y cuotas bajo batería restringida |
| Notificación local | Señal visible y controlable | Puede exponer contenido en lock screen | Android 10 con canal | Requiere visibilidad privada | Bajo | Alta como presentación, no como scheduler | Media | Salida mínima del híbrido | Lock screen, permisos y copy accesible |
| Push remoto | Adelanta sync sin polling continuo | Red, proveedor, TTL y prioridad no garantizan hora | GMS/HMS por verificar | Debe transportar solo una señal opaca | Bajo | Media como hint; baja como única fuente | Alta | Evolución futura, nunca única temporización | GMS/HMS, offline, Doze y entrega degradada |
| Híbrido | Separa temporización, presentación y reconciliación | Más contratos y pruebas | Requiere capa nativa Android | Permite salida privada y consentimiento separado | Bajo/medio | Mayor, sin prometer ejecución absoluta | Alta | **Decisión propuesta** | Matriz física Huawei completa |

### A. Polling solo en foreground

| Criterio | Evaluación |
|---|---|
| Android 10 / Huawei | Compatible y ya presente |
| Precisión | Buena solo mientras la app está visible |
| Reinicio / proceso muerto | No funciona |
| Offline | Solo datos ya cargados mientras Flutter sigue activo |
| Batería | Baja fuera de la app; moderada mientras está visible |
| Privacidad | Buena; no despierta ni habla por sí solo |
| Complejidad | Baja |
| Confiabilidad | Insuficiente como solución de recordatorios |
| Recomendación | Mantener como sincronización foreground, no como scheduler |

### B. Foreground service continuo

| Criterio | Evaluación |
|---|---|
| Android 10 / Huawei | Compatible con permiso y notificación persistente |
| Precisión | Alta mientras el servicio sobreviva |
| Reinicio | Requiere receiver y reinicio explícito del servicio |
| Batería | Alta; proceso, timers y posible red permanentes |
| Privacidad | Notificación permanente; riesgo de mantener más estado activo |
| EMUI | Puede requerir protección manual y prueba física |
| Complejidad | Alta y creciente en Android recientes |
| Confiabilidad | Mejor que polling, pero no inmune a force-stop ni OEM |
| Recomendación | Rechazado como servicio continuo |

Un foreground service **corto**, iniciado por una alarma para reproducir TTS y
detenido inmediatamente después, sí puede evaluarse como parte del híbrido.

### C. AlarmManager

| Criterio | Evaluación |
|---|---|
| Android 10 / Huawei | API disponible; permiso especial de exact alarms no aplica en Android 10 |
| Precisión | Alta con alarma exacta; inexacta puede diferirse |
| Pantalla apagada | `RTC_WAKEUP` puede despertar CPU |
| Doze | Requiere variante `allowWhileIdle` para tiempo preciso |
| Reinicio | Alarmas se pierden; BootReceiver debe reprogramar |
| Offline | Funciona si payload y política ya están locales |
| Batería | Baja si se programan alarmas one-shot y con poca frecuencia |
| Privacidad | Depende de qué se muestre o pronuncie al disparar |
| Complejidad | Media; requiere capa Android nativa y reconciliación |
| Confiabilidad | Mejor base local, salvo force-stop y restricciones OEM |
| Recomendación | Componente principal del híbrido |

En Android 12 o superior deberá comprobarse `canScheduleExactAlarms()` y pedir
acceso especial solo con explicación previa. Si se deniega, Klinip debe degradar
a una alarma inexacta y comunicar que la hora puede variar.

### D. WorkManager

| Criterio | Evaluación |
|---|---|
| Android 10 / Huawei | Compatible mediante AndroidX |
| Precisión | No garantiza minuto exacto |
| Reinicio | El sistema conserva/reprograma trabajo persistente |
| Doze/batería | Respeta cuotas y restricciones del sistema |
| Offline | Puede esperar conectividad para sincronizar |
| Privacidad | No requiere contenido en payload de red |
| Complejidad | Media |
| Confiabilidad | Alta para catch-up y reconciliación eventual |
| Recomendación | Usar para catch-up, limpieza y sync; no para el timbre exacto |

### E. Notificación local programada

| Criterio | Evaluación |
|---|---|
| Android 10 / Huawei | Compatible si existe canal de notificaciones |
| Precisión | Depende del scheduler subyacente |
| Proceso muerto | Puede mostrarse si AlarmManager dispara el receiver |
| Reinicio | Debe reprogramarse |
| Privacidad | Lock screen puede exponer contenido si no se configura |
| Complejidad | Media; requiere canales, acciones y política de visibilidad |
| Confiabilidad | Buena como salida visible, no como mecanismo de scheduling |
| Recomendación | Presentación obligatoria del híbrido |

Una librería de notificaciones no reemplaza AlarmManager o WorkManager. Solo
encapsula cómo se presenta y, según el plugin, cómo se agenda.

### F. Push remoto

| Criterio | Evaluación |
|---|---|
| Android 10 / Huawei | Requiere verificar Google Play Services en el equipo real |
| Precisión | No garantizada; depende de red, Doze y prioridad efectiva |
| Proceso muerto | Puede despertar la app si el proveedor está operativo |
| Reinicio | El proveedor vuelve a registrarse, sujeto a token vigente |
| Offline | No funciona hasta reconectar; TTL limita backlog |
| Batería | Eficiente frente a polling continuo |
| Privacidad | El push debe ser una señal opaca, sin contenido del recordatorio |
| Complejidad | Alta: tokens, rotación, proveedor, observabilidad y fallback |
| Confiabilidad | Útil como hint, insuficiente como única alarma |
| Recomendación | Evolución futura como wake/sync hint |

Para dispositivos Huawei sin servicios Google sería necesario evaluar HMS Push.
No se asume que esa capacidad exista en el Huawei validado.

### G. Solución híbrida

| Criterio | Evaluación |
|---|---|
| Precisión | AlarmManager local para el instante; Flutter cuando está visible |
| Reinicio | BootReceiver más reconciliación WorkManager |
| Offline | Sí, dentro del horizonte ya descargado |
| Proceso muerto | Sí, excepto force-stop |
| Batería | Menor que servicio continuo |
| Privacidad | Contenido cifrado y política de lock screen/TTS |
| Complejidad | Alta, pero separable y testeable |
| Confiabilidad | La mejor combinación sin prometer imposibles |
| Recomendación | Estrategia elegida |

## Estrategia inicial recomendada

1. Cloud materializa un horizonte rodante configurable; valor inicial propuesto:
   72 horas y máximo 100 ocurrencias pendientes por dispositivo.
2. Klinip One descarga, valida, cifra y persiste antes de reportar `delivered`.
3. Una capa Android programa alarmas one-shot por la próxima ocurrencia.
4. Si Flutter está visible, el flujo actual reproduce TTS.
5. Si Flutter no está visible, el receiver publica una notificación local.
6. Como candidato posterior, un modo de dispositivo dedicado y con consentimiento
   explícito podría evaluar un foreground service corto para TTS. Permanece
   deshabilitado hasta probar en Huawei que puede iniciarse, terminar y respetar
   privacidad con la pantalla bloqueada.
7. La única salida propuesta fuera de foreground antes de esa validación es la
   notificación Android. Ningún anuncio TTS con pantalla bloqueada se considera
   garantizado. El candidato no abriría micrófono, cámara ni ubicación y debería
   finalizar inmediatamente después de reproducir voz.
8. WorkManager reconcilia alarmas, outbox, revocación y limpieza de forma eventual.
9. BootReceiver reprograma después del primer desbloqueo del dispositivo.
10. Push remoto podrá añadirse como señal opaca para adelantar sync, nunca como
    única fuente de verdad.

La ventana de 72 horas es configuración operativa, no parte fija del contrato.
Una pérdida de red más larga se comunica como estado degradado; no se inventan
ocurrencias que Cloud no haya materializado.

## Matrices de decisiones complementarias

### Cifrado local

| Alternativa | Ventajas | Riesgos | Compatibilidad | Privacidad | Consumo | Confiabilidad | Complejidad | Recomendación inicial | Validación pendiente |
|---|---|---|---|---|---|---|---|---|---|
| SQLite privado | Sin dependencia nueva | Extracción expone texto | Actual | Básica | Bajo | Alta | Baja | Insuficiente solo | Confirmar sandbox y backup |
| Campos AES-GCM + Keystore | Protege contenido y conserva índices | Migración y pérdida de clave | API 23+, Huawei Android 10 | Alta | Bajo/medio por cifrado por campo | Alta con versionado | Media | **Decisión propuesta** | Disponibilidad de hardware backing, rotación y pérdida |
| SQLCipher + Keystore | Cifra base, WAL y journals | Nueva SQLite nativa, migración global | Requiere plugin/binarios compatibles | Muy alta | Medio | Alta tras validar | Alta | Evolución futura | Rendimiento y compatibilidad con sqflite |
| Cifrar solo outbox | Reduce exposición de pendientes | Título/cuerpo siguen claros | Alta | Parcial | Bajo | Alta | Baja | Rechazada | No aplica inicialmente |

### Retención

| Alternativa | Ventajas | Riesgos | Compatibilidad | Privacidad | Consumo | Confiabilidad | Complejidad | Recomendación inicial | Validación pendiente |
|---|---|---|---|---|---|---|---|---|---|
| Eliminar todo al completar | Minimización máxima | Rompe idempotencia y auditoría | Cloud/One | Muy alta | Bajo almacenamiento; limpieza media | Baja ante replay | Media | Rechazada | Reintento después de prune |
| Contenido corto + tombstone | Equilibra borrado, replay y soporte | Metadata temporal permanece | Cloud/One | Alta | Bajo/medio | Alta | Media | **Propuesta, sujeta a aprobación** | Pruning, wipe y DB compactada |
| Conservar 1 año completo | Diagnóstico sencillo | Crea historial de rutinas | Cloud/One | Baja | Alto por volumen | Alta | Baja | Rechazada | No aplica inicialmente |
| Configurable sin defaults | Flexible | Conducta impredecible | Cloud/One | Variable | Variable | Media | Alta | Rechazada inicialmente | No aplica inicialmente |

### DST y zona horaria

| Alternativa | Ventajas | Riesgos | Compatibilidad | Privacidad | Consumo | Confiabilidad | Complejidad | Recomendación inicial | Validación pendiente |
|---|---|---|---|---|---|---|---|---|---|
| Offset fijo | Simple | Falla en DST/viajes | Actual parcial | Neutra | Bajo | Baja | Baja | Rechazada | Simular cambio de hora |
| UTC absoluto recurrente | Intervalo estable | Deriva de hora civil | Universal | Neutra | Bajo | Media | Baja | Solo modo futuro explícito | Comparar días de 23/25 horas |
| Wall-clock IANA | Respeta intención civil | Requiere gap/fold/tzdb | Cloud y resolver nuevo en One | Zona es dato sensible | Bajo en runtime; mantenimiento tzdb | Alta | Media | **Decisión propuesta** | DST Chile, viaje y cambio de zona |
| Rechazar toda hora DST | Evita decisión automática | Mala UX y no cubre recurrencia futura | Universal | Neutra | Bajo | Media | Media | Rechazada | No aplica inicialmente |

### Creación offline

| Alternativa | Ventajas | Riesgos | Compatibilidad | Privacidad | Consumo | Confiabilidad | Complejidad | Recomendación inicial | Validación pendiente |
|---|---|---|---|---|---|---|---|---|---|
| No permitir | Semántica clara | Pierde intención del usuario | Actual | Alta | Bajo | Alta | Baja | Fallback aceptable | Modo avión |
| Draft pendiente | Conserva intención sin prometer alarma | Puede vencer y requiere sync | SQLite/outbox futuro | Alta si cifrado | Bajo | Alta | Media | **Decisión propuesta** | Reconexión, vencimiento y pérdida de clave |
| Reminder local provisional | Puede sonar offline | Dos autoridades y conflictos | Requiere runtime completo | Media | Medio | Media | Alta | Rechazada inicialmente | Duplicados y reconciliación |
| Programar local y sync tardío | Máxima utilidad offline | Divergencia, target y permisos obsoletos | Requiere AlarmManager | Media | Medio | Baja | Muy alta | Rechazada | No aplica inicialmente |

### Múltiples dispositivos

| Alternativa | Ventajas | Riesgos | Compatibilidad | Privacidad | Consumo | Confiabilidad | Complejidad | Recomendación inicial | Validación pendiente |
|---|---|---|---|---|---|---|---|---|---|
| Todos | Cobertura máxima | Audio duplicado y más exposición | Modelo delivery lo permitiría | Baja | Alto por red/audio duplicado | Media | Alta | Fuera de v1 | Dos dispositivos simultáneos |
| Primero activo | Reduce duplicado aparente | Selección no determinista y carrera | Requiere presencia confiable | Media | Alto por presencia frecuente | Baja | Muy alta | Rechazada | Offline y latencia |
| Preferido explícito | Predecible y privado | Puede estar offline/revocado | Device Identity actual | Alta | Bajo | Alta | Media | **Decisión propuesta** | Revocación y reasignación |
| Solo creador | Muy simple para voz | Web y reemplazo de equipo quedan limitados | Parcial | Alta | Bajo | Media | Baja | Default de voz, no política global | Cambio de dispositivo |

## Privacidad de la salida

Modo predeterminado con pantalla bloqueada:

- notificación con visibilidad privada;
- frase genérica: “Tienes un recordatorio”;
- sin título ni cuerpo en lock screen;
- contenido completo solo al desbloquear o abrir Klinip One.

Modo dedicado opcional:

- consentimiento explícito y reversible;
- respeta PrivateMode, RestMode y horario activo reflejados en almacenamiento
  nativo mínimo;
- queda como candidato de prueba, deshabilitado hasta validar Huawei;
- no se afirma que pueda pronunciar contenido con la pantalla bloqueada;
- si se valida, deberá mantener notificación visible durante TTS;
- nunca inicia escucha contextual en background.

## Riesgos que requieren validación física

- exactitud real de `setExactAndAllowWhileIdle()` en EMUI 10;
- recepción de BOOT_COMPLETED y reprogramación después del primer unlock;
- comportamiento con App launch automático/manual;
- efecto de Battery optimization y ahorro extremo;
- supervivencia del receiver con pantalla apagada;
- inicio y cierre del foreground service corto;
- TTS con pantalla bloqueada;
- disponibilidad de Google Play Services y FCM;
- comportamiento después de force-stop;
- consumo de batería durante 24 y 72 horas;
- privacidad de la notificación en lock screen.

## Fuentes primarias y de referencia

- [Android: Schedule alarms](https://developer.android.com/develop/background-work/services/alarms)
- [Android: Define WorkRequests](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work)
- [Android: Foreground services](https://developer.android.com/develop/background-work/services/fgs)
- [Android: Foreground service background restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
- [Android: Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)
- [Android: package stopped state](https://developer.android.com/reference/android/content/Intent#ACTION_PACKAGE_UNSTOPPED)
- [Firebase: Android message priority](https://firebase.google.com/docs/cloud-messaging/android-message-priority)
- [Huawei: background protection on EMUI 9+](https://consumer.huawei.com/en/support/content/en-us15850065/)
