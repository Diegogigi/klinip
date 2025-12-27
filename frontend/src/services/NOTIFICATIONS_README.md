# Sistema de Notificaciones Mejorado para Klinip

Este documento describe el nuevo sistema de notificaciones implementado en Klinip, diseñado para funcionar tanto en dispositivos móviles como de escritorio.

## 📋 Características Principales

### 1. **Persistencia de Notificaciones**
- Las notificaciones programadas se guardan en `localStorage`
- Sobreviven a reinicios del navegador
- Se limpian automáticamente después de 30 días

### 2. **Notificaciones Push**
- Funcionan incluso con la aplicación cerrada
- Soporte para Web Push API con VAPID
- Compatible con móviles y escritorio

### 3. **Alarmas Personalizables**
- Configuración de tiempos de recordatorio
- Múltiples alertas para una misma cita
- Opciones: 7 días, 3 días, 1 día, 2 horas, 30 minutos antes

### 4. **Sonidos Diferenciados**
- Sonido específico para citas
- Sonido específico para medicación
- Sonido de urgencia para alertas críticas
- Sonido predeterminado para otras notificaciones

### 5. **Service Worker Mejorado**
- Cache inteligente de recursos
- Background Sync para sincronización offline
- Soporte para posponer notificaciones (snooze)
- Verificación periódica de notificaciones pendientes

### 6. **Panel de Configuración**
- Interfaz completa para gestionar preferencias
- Estadísticas de notificaciones
- Control granular de recordatorios
- Activar/desactivar tipos de notificación

## 🚀 Uso Básico

### Solicitar Permiso de Notificaciones

```javascript
import { requestNotificationPermission } from '../services/notificationManager';

const granted = await requestNotificationPermission();
if (granted) {
  console.log('Notificaciones habilitadas');
}
```

### Programar Recordatorios de Citas

```javascript
import { scheduleReminderNotifications } from '../services/notificationManager';

const appointments = await getAppointments();
scheduleReminderNotifications(appointments);
```

### Programar Recordatorios de Medicación

```javascript
import { scheduleMedicationNotifications } from '../services/notificationManager';

const medications = await getMedications();
scheduleMedicationNotifications(medications);
```

### Crear Notificación Personalizada

```javascript
import { createCustomNotification } from '../services/notificationManager';

createCustomNotification({
  title: "Recordatorio Personal",
  body: "No olvides tu análisis de sangre",
  triggerAt: new Date('2025-12-28T09:00:00').getTime(),
  sound: "urgent",
  url: "/appointments"
});
```

### Obtener Estadísticas

```javascript
import { getNotificationStats } from '../services/notificationManager';

const stats = getNotificationStats();
console.log(`Notificaciones programadas: ${stats.total}`);
```

## 🔧 Configuración Personalizada

### Modificar Tiempos de Recordatorio

```javascript
const customOffsets = [
  { days: 14, label: "2 semanas antes", icon: "🟢", priority: "low", sound: "appointment" },
  { days: 7, label: "1 semana antes", icon: "🟡", priority: "normal", sound: "appointment" },
  { hours: 1, label: "1 hora antes", icon: "🔴", priority: "urgent", sound: "urgent" }
];

scheduleReminderNotifications(appointments, customOffsets);
```

## 🎨 Integración en Componentes

### Agregar Botón de Configuración

```jsx
import { useState } from 'react';
import NotificationSettings from '../components/NotificationSettings';

function MyComponent() {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <>
      <button onClick={() => setShowSettings(true)}>
        ⚙️ Configurar Notificaciones
      </button>
      
      {showSettings && (
        <NotificationSettings onClose={() => setShowSettings(false)} />
      )}
    </>
  );
}
```

## 📡 Backend API

### Enviar Recordatorios desde el Backend

#### Recordatorios de Citas
```bash
POST /push/send-reminders
Authorization: Bearer <token>
```

Respuesta:
```json
{
  "sent": 3,
  "appointments_checked": 5,
  "message": "Se enviaron 3 recordatorios"
}
```

#### Recordatorios de Medicación
```bash
POST /push/send-medication-reminders
Authorization: Bearer <token>
```

Respuesta:
```json
{
  "sent": 2,
  "medications_checked": 2,
  "message": "Se enviaron 2 recordatorios"
}
```

### Programar Tarea Cron (Opcional)

Para enviar recordatorios automáticamente, puedes configurar una tarea cron que llame a estos endpoints periódicamente:

```bash
# Cada día a las 9:00 AM
0 9 * * * curl -X POST https://tu-app.com/push/send-reminders -H "Authorization: Bearer TOKEN"

# Cada hora
0 * * * * curl -X POST https://tu-app.com/push/send-medication-reminders -H "Authorization: Bearer TOKEN"
```

## 🔊 Configuración de Sonidos

Los archivos de sonido deben colocarse en `frontend/public/sounds/`:

- `notification.mp3` - Sonido predeterminado
- `appointment.mp3` - Recordatorios de citas
- `medication.mp3` - Recordatorios de medicación
- `urgent.mp3` - Notificaciones urgentes

Ver `frontend/public/sounds/README.md` para más detalles.

## 🛠️ Service Worker

El service worker se registra automáticamente en `App.jsx`:

```javascript
import { registerServiceWorker, ensurePushSubscription } from './services/pwa';

useEffect(() => {
  registerServiceWorker();
  ensurePushSubscription();
}, []);
```

### Funcionalidades del Service Worker

1. **Cache de Recursos**: Mejora el rendimiento y permite uso offline
2. **Push Notifications**: Recibe notificaciones del servidor
3. **Background Sync**: Sincroniza datos cuando vuelve la conexión
4. **Snooze**: Permite posponer notificaciones 10 minutos
5. **Periodic Sync**: Verifica notificaciones pendientes cada minuto

## 📱 Soporte de Plataformas

### Desktop
- ✅ Chrome/Edge (Web Push API completo)
- ✅ Firefox (Web Push API completo)
- ⚠️ Safari (limitado, sin push en macOS < 16.4)

### Móvil
- ✅ Android (Chrome, Firefox)
- ✅ iOS 16.4+ (Safari con PWA instalado)
- ✅ Samsung Internet
- ✅ Opera Mobile

## 🔐 Variables de Entorno

Para habilitar notificaciones push, configura estas variables:

### Backend (.env)
```env
VAPID_PUBLIC_KEY=tu_clave_publica_vapid
VAPID_PRIVATE_KEY=tu_clave_privada_vapid
VAPID_EMAIL=mailto:klinip.informacion@gmail.com
```

### Frontend (.env)
```env
VITE_VAPID_PUBLIC_KEY=tu_clave_publica_vapid
```

### Generar Claves VAPID

```bash
# Usando web-push CLI
npm install -g web-push
web-push generate-vapid-keys

# O usando Python
pip install pywebpush
python -c "from pywebpush import webpush; print(webpush.generate_vapid_keys())"
```

## 🐛 Debugging

### Ver Notificaciones Programadas en Console

```javascript
import { notificationManager } from '../services/notificationManager';

console.log(notificationManager.getPendingNotifications());
```

### Ver Service Worker en DevTools

1. Chrome DevTools → Application → Service Workers
2. Firefox DevTools → Application → Service Workers
3. Ver logs de push en la consola

### Probar Notificación

```javascript
// En la consola del navegador
import { createCustomNotification } from './services/notificationManager';

createCustomNotification({
  title: "Prueba",
  body: "Esta es una prueba",
  triggerAt: Date.now() + 5000, // 5 segundos
  sound: "default"
});
```

## 📊 Estadísticas y Monitoreo

El sistema proporciona estadísticas en tiempo real:

```javascript
const stats = getNotificationStats();
/*
{
  scheduled: 15,      // Total en localStorage
  appointments: 9,    // Timers activos de citas
  medications: 6,     // Timers activos de medicación
  total: 15          // Total de timers activos
}
*/
```

## 🎯 Mejores Prácticas

1. **Solicita permiso en contexto**: Pide permisos cuando el usuario realice una acción relacionada
2. **Limpia notificaciones antiguas**: El sistema lo hace automáticamente
3. **No sobrecargues**: Usa tiempos de recordatorio razonables
4. **Prueba en diferentes dispositivos**: Especialmente iOS Safari
5. **Proporciona alternativas**: Email, SMS si las notificaciones fallan

## 🔄 Actualizaciones Futuras

Características planificadas:
- [ ] Notificaciones con imágenes (rich notifications)
- [ ] Acciones inline (marcar como completado desde la notificación)
- [ ] Geolocalización (recordar al llegar al centro médico)
- [ ] Integración con calendario del sistema
- [ ] Modo "No Molestar" inteligente

## 📝 Licencia

Este sistema es parte de Klinip y está sujeto a la misma licencia del proyecto principal.

