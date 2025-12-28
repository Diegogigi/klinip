# 🚂 Configuración de Variables de Entorno en Railway

## 📋 Resumen

Si tienes **frontend y backend en el mismo servicio** de Railway, necesitas configurar las variables de entorno para que ambos puedan acceder a las claves VAPID.

---

## ⚙️ Variables Requeridas en Railway

En tu servicio de Railway, ve a **Settings → Variables** y agrega las siguientes:

### **Variables del Backend** (3 variables)

```env
VAPID_PUBLIC_KEY=BDjl4UpuCPrwu_fpTIC-5Hncer74Wf2Eny1JkOII5bAx1y4KjcwrL-j2WdDC5znK4U0R3GlMjPvHHYuOfCLyd6o
VAPID_PRIVATE_KEY=SV2tbGuj2tX1NqgADxWQ_OEwd_JluSzmcIVhzh6oHVg
VAPID_EMAIL=mailto:klinip.informacion@gmail.com
```

### **Variable del Frontend** (1 variable)

```env
VITE_VAPID_PUBLIC_KEY=BDjl4UpuCPrwu_fpTIC-5Hncer74Wf2Eny1JkOII5bAx1y4KjcwrL-j2WdDC5znK4U0R3GlMjPvHHYuOfCLyd6o
```

---

## 🔑 Explicación de las Variables

| Variable                | Dónde se usa | Descripción                                                  |
| ----------------------- | ------------ | ------------------------------------------------------------ |
| `VAPID_PUBLIC_KEY`      | Backend      | Clave pública para firmar notificaciones push                |
| `VAPID_PRIVATE_KEY`     | Backend      | Clave privada (SECRETA) para autenticar con el servidor push |
| `VAPID_EMAIL`           | Backend      | Email de contacto para el servicio push                      |
| `VITE_VAPID_PUBLIC_KEY` | Frontend     | Misma clave pública para que el navegador se suscriba        |

---

## ✅ Verificación

### **1. Verificar que las variables están configuradas**

En Railway, ve a tu servicio → **Settings → Variables** y confirma que las 4 variables están presentes.

### **2. Reiniciar el servicio**

Después de agregar las variables, **reinicia el servicio** para que los cambios surtan efecto:

```bash
# Railway reiniciará automáticamente al detectar cambios en variables
# O puedes forzar un redeploy desde la interfaz
```

### **3. Verificar en la consola del navegador**

Abre tu aplicación en producción y abre la consola del navegador (F12):

```javascript
// Verifica que la clave VAPID esté disponible
console.log(import.meta.env.VITE_VAPID_PUBLIC_KEY);
// Debería mostrar: BDjl4UpuCPrwu_fpTIC-5Hncer74Wf2Eny1JkOII5bAx1y4KjcwrL-j2WdDC5znK4U0R3GlMjPvHHYuOfCLyd6o
```

Si muestra `undefined`, significa que la variable no está configurada correctamente.

---

## 🚨 Problemas Comunes

### **Problema 1: "Error de configuración: Falta la clave VAPID"**

**Causa**: La variable `VITE_VAPID_PUBLIC_KEY` no está configurada en Railway.

**Solución**:

1. Ve a Railway → Settings → Variables
2. Agrega `VITE_VAPID_PUBLIC_KEY` con el valor correcto
3. Reinicia el servicio

### **Problema 2: Las notificaciones se desactivan al cerrar el formulario**

**Causa**: El estado no se está cargando correctamente desde el backend.

**Solución**: Ya está corregido en el código. Asegúrate de tener la última versión desplegada.

### **Problema 3: No llegan notificaciones push**

**Causa**: Puede ser que el backend no tenga las claves VAPID configuradas.

**Solución**:

1. Verifica que `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_EMAIL` estén en Railway
2. Reinicia el servicio
3. Usa el botón "🧪 Enviar Notificación de Prueba" en la configuración

---

## 🧪 Probar las Notificaciones

### **Paso 1: Habilitar notificaciones**

1. Abre la app en tu móvil o navegador
2. Ve a **Configuración** → **🔔 Notificaciones y Recordatorios**
3. Habilita las **Notificaciones Push**
4. Deberías ver: "✅ Notificaciones push habilitadas correctamente"

### **Paso 2: Verificar persistencia**

1. Cierra el formulario de configuración
2. Vuelve a abrirlo
3. El estado debería seguir en: "✅ Activas"

### **Paso 3: Enviar notificación de prueba**

1. Con las notificaciones habilitadas, haz clic en **🧪 Enviar Notificación de Prueba**
2. Deberías recibir una notificación en unos segundos

---

## 📱 Requisitos para Móviles

Para que las notificaciones push funcionen en móviles, **DEBES** tener:

1. ✅ **HTTPS** (obligatorio en móviles)
2. ✅ Permisos de notificaciones habilitados en el navegador
3. ✅ Variables de entorno configuradas correctamente
4. ✅ Service Worker registrado

Railway proporciona HTTPS automáticamente, así que este requisito ya está cubierto.

---

## 🔍 Logs de Depuración

Si tienes problemas, abre la consola del navegador y busca estos mensajes:

### **✅ Configuración correcta:**

```
🔍 Suscripción en navegador: ✅ Activa
📊 Estado en backend: ✅ Registrada
🎯 Estado final de push: ✅ ACTIVO
```

### **❌ Problema de configuración:**

```
❌ Error en ensurePushSubscription: Error de configuración: Falta la clave VAPID
```

**Solución**: Agrega `VITE_VAPID_PUBLIC_KEY` en Railway.

### **⚠️ Desincronización:**

```
⚠️ Desincronización detectada entre navegador y backend
→ El navegador tiene suscripción pero el backend no
```

**Solución**: Deshabilita y vuelve a habilitar las notificaciones push.

---

## 📞 Soporte

Si después de seguir estos pasos sigues teniendo problemas:

1. Verifica los logs del backend en Railway
2. Verifica la consola del navegador (F12)
3. Usa el botón de prueba para diagnosticar
4. Revisa que todas las 4 variables estén configuradas correctamente

---

## 🎯 Checklist Final

Antes de considerar que todo está funcionando:

- [ ] Las 4 variables están en Railway
- [ ] El servicio se reinició después de agregar las variables
- [ ] La consola muestra `VITE_VAPID_PUBLIC_KEY` correctamente
- [ ] Las notificaciones se pueden habilitar sin errores
- [ ] El estado persiste al cerrar/abrir el formulario
- [ ] La notificación de prueba llega correctamente
- [ ] Funciona tanto en escritorio como en móvil

---

**¡Listo!** Con esta configuración, las notificaciones push deberían funcionar perfectamente en Railway. 🚀
