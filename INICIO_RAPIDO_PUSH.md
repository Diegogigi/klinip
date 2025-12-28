# 🚀 Inicio Rápido: Notificaciones Push en Móviles

## ⚡ Configuración en 3 Pasos

### Paso 1: Configurar Claves VAPID en el Frontend

```bash
# 1. Ir al directorio del frontend
cd frontend

# 2. Crear el archivo .env (si no existe)
# En Windows PowerShell:
echo "VITE_VAPID_PUBLIC_KEY=tu_clave_publica_aqui" > .env

# En Linux/Mac:
echo "VITE_VAPID_PUBLIC_KEY=tu_clave_publica_aqui" > .env
```

**Edita el archivo `.env` y reemplaza `tu_clave_publica_aqui` con la clave del archivo `CONFIGURACION_VAPID.txt`**

**Ejemplo de `frontend/.env`:**
```env
VITE_VAPID_PUBLIC_KEY=BNg8KxYzAbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMnOpQrStUvWxYz
VITE_API_URL=https://tu-dominio.com
```

### Paso 2: Reiniciar el Frontend

```bash
# Detener el servidor actual (Ctrl+C)
# Luego reiniciar:
npm run dev
```

### Paso 3: Verificar en el Navegador

Abre la consola del navegador (F12) y ejecuta:

```javascript
console.log("Clave VAPID:", import.meta.env.VITE_VAPID_PUBLIC_KEY);
```

✅ **Debe mostrar tu clave completa**
❌ **Si muestra `undefined`**, revisa el `.env` y reinicia el servidor

---

## 🔍 Solución Rápida de Problemas

### Problema: "Error de configuración: Falta la clave VAPID"

**Solución:**
```bash
cd frontend
# Verifica que .env exista
cat .env  # Linux/Mac
type .env  # Windows

# Si no existe o está vacío, créalo:
echo "VITE_VAPID_PUBLIC_KEY=tu_clave" > .env

# Reinicia el servidor
npm run dev
```

### Problema: "Las notificaciones push requieren HTTPS"

**Solución:**
- En desarrollo: Usa `http://localhost:5173` ✅
- En producción: **DEBES usar HTTPS** ✅
- Nunca uses HTTP en producción ❌

### Problema: El botón no hace nada en móvil

**Solución:**
1. Abre el sitio en **Chrome para Android** (navegador recomendado)
2. Presiona el botón de push
3. Cuando aparezca el popup, presiona **"Permitir"**
4. Si no aparece el popup, verifica los pasos 1 y 2 arriba

---

## 📱 Prueba en Móvil

### Android

1. Abre Chrome en tu móvil
2. Ve a tu sitio: `https://tu-dominio.com`
3. Ve a **Perfil > ⚙️ Configuración de Notificaciones**
4. Presiona **"Habilitar Notificaciones Push"**
5. Cuando aparezca el popup, presiona **"Permitir"**
6. Verás: ✅ **Notificaciones push habilitadas correctamente**

### iOS (iPhone/iPad)

1. Abre Safari
2. Ve a tu sitio: `https://tu-dominio.com`
3. Presiona el botón de **Compartir** (cuadrado con flecha)
4. Selecciona **"Agregar a pantalla de inicio"**
5. Abre la app desde el ícono en tu pantalla
6. Ve a **Perfil > ⚙️ Configuración de Notificaciones**
7. Presiona **"Habilitar Notificaciones Push"**
8. Verás: ✅ **Notificaciones push habilitadas correctamente**

---

## ✅ Verificación Final

Una vez configurado, deberías poder:

1. ✅ Ver en **Perfil > Notificaciones**:
   - Estado: **Notificaciones push: ✅ Activas**

2. ✅ Recibir notificaciones automáticas:
   - Recordatorios de citas
   - Recordatorios de medicamentos

3. ✅ Ver en la consola del navegador:
   ```
   ✅ Suscripción registrada en el servidor
   ```

---

## 🆘 ¿Sigue sin funcionar?

Lee la guía completa: `CONFIGURACION_PUSH_MOVILES.md`

O verifica:
1. Que el backend tenga las claves VAPID en su `.env`
2. Que el frontend tenga la clave pública en su `.env`
3. Que ambos servidores estén reiniciados
4. Que estés en HTTPS (en producción)
5. Que el navegador sea compatible

---

## 🎉 ¡Listo!

Una vez que veas **✅ Notificaciones push: Activas**, el sistema está funcionando.

El servidor enviará automáticamente:
- Recordatorios de citas (7 días, 3 días, 1 día, 2 horas, 30 minutos antes)
- Recordatorios de medicamentos (según los horarios configurados)



