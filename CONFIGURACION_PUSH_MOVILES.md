# 📱 Configuración de Notificaciones Push para Móviles

## 🚨 Problemas Comunes y Soluciones

### ❌ El botón de push no funciona en móvil

#### **Causa 1: Falta configurar la clave VAPID en el frontend**

**Solución:**
1. Abre el archivo `CONFIGURACION_VAPID.txt` y copia la `CLAVE PÚBLICA`
2. Crea o edita el archivo `frontend/.env`
3. Agrega esta línea:
```
VITE_VAPID_PUBLIC_KEY=tu_clave_publica_aqui
```

**Ejemplo de `frontend/.env` completo:**
```env
VITE_VAPID_PUBLIC_KEY=BNg8K...tu_clave_completa_aqui...zXyZ
VITE_API_URL=https://tu-dominio.com
```

4. **IMPORTANTE:** Después de modificar `.env`, debes **reiniciar el servidor frontend**:
```bash
cd frontend
npm run dev
```

---

#### **Causa 2: No estás en HTTPS**

Las notificaciones push **REQUIEREN HTTPS** en móviles (excepto en localhost).

**Verificación:**
- ❌ `http://tu-dominio.com` → **NO funciona**
- ✅ `https://tu-dominio.com` → **Funciona**
- ✅ `http://localhost:5173` → **Funciona** (solo en desarrollo)

**Solución en producción:**
1. Configura un certificado SSL (Let's Encrypt es gratis)
2. Redirige todo el tráfico HTTP a HTTPS
3. Accede siempre usando `https://`

**Con Nginx:**
```nginx
server {
    listen 80;
    server_name tu-dominio.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name tu-dominio.com;
    
    ssl_certificate /etc/letsencrypt/live/tu-dominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tu-dominio.com/privkey.pem;
    
    # ... resto de la configuración
}
```

---

#### **Causa 3: El navegador del móvil no soporta push**

**Navegadores compatibles:**
- ✅ Chrome para Android
- ✅ Firefox para Android
- ✅ Edge para Android
- ✅ Samsung Internet
- ✅ Safari para iOS 16.4+ (PWA instalada)
- ❌ Safari para iOS (sin instalar como PWA)
- ❌ Navegadores antiguos

**Solución:**
- Actualiza el navegador a la última versión
- En iOS: Instala la aplicación como PWA (agregar a pantalla de inicio)

---

#### **Causa 4: Permisos bloqueados en el navegador**

**Síntomas:**
- El botón no hace nada
- No aparece el popup de permisos

**Solución en Android:**
1. Abre **Configuración del sitio** en Chrome
2. Ve a **Notificaciones**
3. Encuentra tu sitio
4. Cambia de "Bloqueado" a "Permitir"

**Solución en iOS:**
1. Instala la app como PWA (botón "Agregar a pantalla de inicio")
2. Abre la app desde el ícono en la pantalla de inicio
3. Ve a Configuración > Notificaciones
4. Habilita notificaciones para la app

---

## 🔍 Diagnóstico de Problemas

### Paso 1: Abrir la consola del navegador en móvil

#### Android Chrome:
1. En el móvil, abre la app
2. En tu PC, abre Chrome
3. Escribe en la barra: `chrome://inspect`
4. Selecciona tu dispositivo y la pestaña
5. Haz clic en "inspect"

#### iOS Safari:
1. En iPhone: Ajustes > Safari > Avanzado > Activar "Inspector Web"
2. En Mac: Safari > Preferencias > Avanzado > Mostrar menú Desarrollador
3. Conecta el iPhone por USB
4. Safari en Mac > Desarrollar > [Tu iPhone] > [Tu página]

### Paso 2: Ver los errores en la consola

Presiona el botón de push y observa los mensajes. Verás algo como:

```
🔄 Iniciando habilitación de push...
Solicitando permiso de notificaciones...
Permiso obtenido: granted
Esperando service worker...
Service worker listo
Cancelando suscripción anterior...
Suscripción anterior cancelada
Creando nueva suscripción push...
Suscripción creada: https://...
Enviando suscripción al servidor...
✅ Suscripción registrada en el servidor
```

Si hay un error, verás un mensaje específico como:
- `"Error de configuración: Falta la clave VAPID"` → Configura el `.env`
- `"Las notificaciones push requieren HTTPS"` → Usa HTTPS
- `"Tu navegador no soporta notificaciones push"` → Actualiza el navegador

---

## ✅ Checklist de Configuración Completa

### Backend
- [ ] Variables de entorno configuradas en `backend/.env`:
  ```
  VAPID_PUBLIC_KEY=...
  VAPID_PRIVATE_KEY=...
  VAPID_EMAIL=klinip.informacion@gmail.com
  ```
- [ ] Backend reiniciado: `python -m uvicorn app.main:app --reload`

### Frontend
- [ ] Variables de entorno configuradas en `frontend/.env`:
  ```
  VITE_VAPID_PUBLIC_KEY=...
  VITE_API_URL=https://tu-dominio.com
  ```
- [ ] Frontend reiniciado: `npm run dev`
- [ ] Build de producción: `npm run build`

### Servidor (Producción)
- [ ] Certificado SSL configurado
- [ ] Acceso por HTTPS habilitado
- [ ] Firewall permite puerto 443
- [ ] DNS apunta al servidor correcto

### Cliente (Móvil)
- [ ] Navegador actualizado
- [ ] Accediendo por HTTPS
- [ ] Permisos de notificación permitidos
- [ ] En iOS: App instalada como PWA

---

## 🧪 Prueba Rápida

### 1. Verificar que la clave VAPID está cargada

Abre la consola en el navegador y ejecuta:
```javascript
console.log(import.meta.env.VITE_VAPID_PUBLIC_KEY);
```

**Debe mostrar:** Tu clave pública completa (ejemplo: `BNg8K...`)
**Si muestra `undefined`:** No configuraste el `.env` o no reiniciaste el servidor

### 2. Verificar HTTPS

Abre la consola y ejecuta:
```javascript
console.log(window.location.protocol);
```

**Debe mostrar:** `"https:"` (en producción) o `"http:"` (solo en localhost)
**Si muestra `"http:"` en producción:** Configura SSL

### 3. Verificar soporte del navegador

Abre la consola y ejecuta:
```javascript
console.log({
  serviceWorker: 'serviceWorker' in navigator,
  pushManager: 'PushManager' in window,
  notifications: 'Notification' in window
});
```

**Debe mostrar:**
```javascript
{
  serviceWorker: true,
  pushManager: true,
  notifications: true
}
```

**Si alguno es `false`:** Tu navegador no es compatible

---

## 📞 Soporte

Si después de seguir todos estos pasos sigue sin funcionar:

1. Verifica los logs del backend: `tail -f backend/logs/app.log`
2. Verifica la consola del navegador en móvil (ver arriba)
3. Comparte el mensaje de error específico que aparece

---

## 🎯 Resumen

Para que las notificaciones push funcionen en móvil necesitas:

1. ✅ **Clave VAPID configurada** en `frontend/.env`
2. ✅ **HTTPS habilitado** (excepto localhost)
3. ✅ **Navegador compatible** actualizado
4. ✅ **Permisos concedidos** por el usuario
5. ✅ **Service worker registrado** correctamente

Una vez configurado todo correctamente, el botón funcionará y verás el mensaje:
> ✅ Notificaciones push habilitadas correctamente. Recibirás recordatorios automáticos.

