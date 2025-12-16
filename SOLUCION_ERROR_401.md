# Solución al Error 401 - Token inválido o expirado

## 🔍 Problema Identificado

El error 401 que estás experimentando se debe a que la variable de entorno `SECRET_KEY` no está configurada en Railway, o está usando un valor diferente al que se usó para generar los tokens.

## ✅ Cambios Realizados

1. **Modificado `backend/app/auth.py`**:

   - Ahora lee `SECRET_KEY` desde variables de entorno
   - Agrega validación para detectar si `SECRET_KEY` no está configurado en producción
   - Mejora los mensajes de error para ser más descriptivos

2. **Mejorado el manejo de errores en `frontend/src/pages/Login.jsx`**:

   - Mejor manejo cuando falla la verificación del usuario después del login

3. **Creada documentación completa**:
   - `VARIABLES_ENTORNO.md` con todas las variables necesarias

## 🚀 Pasos para Solucionar el Problema

### Paso 1: Generar una Clave Secreta Segura

Ejecuta este comando en tu terminal (o en Railway):

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Esto generará una clave como: `abc123xyz789...` (copia esta clave completa)

### Paso 2: Configurar Variables en Railway

1. Ve a tu proyecto en [Railway](https://railway.app)
2. Selecciona el servicio del **Backend**
3. Ve a la pestaña **Variables**
4. Haz clic en **+ New Variable**
5. Agrega las siguientes variables:

#### Variable 1: `SECRET_KEY`

- **Nombre**: `SECRET_KEY`
- **Valor**: Pega la clave que generaste en el Paso 1
- **⚠️ IMPORTANTE**: Esta clave debe ser única y segura. No uses la clave por defecto.

#### Variable 2: `DATABASE_URL` (si no está automática)

- Railway generalmente proporciona esta variable automáticamente cuando agregas PostgreSQL
- Si no está, agrega:
  - **Nombre**: `DATABASE_URL`
  - **Valor**: `postgresql://usuario:password@host:puerto/database`
  - Puedes obtener esta URL desde el servicio PostgreSQL en Railway

### Paso 3: Configurar Variable del Frontend (si aplica)

Si tu frontend está en un servicio separado:

1. Selecciona el servicio del **Frontend**
2. Ve a **Variables**
3. Agrega:
   - **Nombre**: `VITE_API_URL`
   - **Valor**: `https://tu-backend.up.railway.app` (reemplaza con la URL real de tu backend)

**Nota**: Si usas nixpacks (frontend y backend en el mismo servicio), solo necesitas configurar las variables del backend.

### Paso 4: Reiniciar el Servicio

Después de agregar las variables:

1. Ve a la pestaña **Deployments** en Railway
2. Haz clic en **Redeploy** o espera a que Railway detecte los cambios y redespiegue automáticamente

### Paso 5: Verificar que Funciona

1. Espera a que el despliegue termine (puede tomar 1-2 minutos)
2. Intenta hacer login nuevamente
3. Si aún falla, verifica los logs del backend en Railway para ver mensajes de error

## 📋 Resumen de Variables Requeridas

### Backend (OBLIGATORIAS):

- ✅ `SECRET_KEY` - Clave secreta para JWT (generar una nueva)
- ✅ `DATABASE_URL` - URL de PostgreSQL (Railway la proporciona automáticamente)

### Frontend (si está en servicio separado):

- ✅ `VITE_API_URL` - URL del backend (ej: `https://tu-backend.up.railway.app`)

### Opcionales:

- `ACCESS_TOKEN_EXPIRE_MINUTES` - Tiempo de expiración del token (por defecto 1440 = 24 horas)

## 🔍 Verificación

### Verificar que las variables están configuradas:

1. **Health Check**: Visita `https://tu-backend.up.railway.app/health`

   - Debe mostrar `"status": "ok"` y `"database": "ok"`

2. **Verificar SECRET_KEY en logs**:
   - Si ves el mensaje "⚠️ ADVERTENCIA: SECRET_KEY no está configurado" en los logs, significa que la variable no está configurada correctamente

### Si el problema persiste:

1. **Verifica los logs del backend** en Railway:

   - Busca mensajes que empiecen con "DEBUG get_current_user"
   - Estos te dirán exactamente qué está fallando

2. **Verifica que el token se está enviando**:

   - Abre las herramientas de desarrollador del navegador (F12)
   - Ve a la pestaña Network
   - Intenta hacer login
   - Verifica que la petición a `/me` incluya el header `Authorization: Bearer <token>`

3. **Limpia el localStorage**:
   - En la consola del navegador, ejecuta: `localStorage.clear()`
   - Intenta hacer login nuevamente

## ⚠️ Notas Importantes

1. **SECRET_KEY es crítica**: Si cambias esta clave, todos los tokens existentes se invalidarán. Los usuarios tendrán que hacer login nuevamente.

2. **No uses la clave por defecto en producción**: El código ahora valida esto y mostrará una advertencia en los logs.

3. **Mantén la clave segura**: Nunca subas el `SECRET_KEY` a Git o la compartas públicamente.

## 📞 Si Necesitas Más Ayuda

Si después de seguir estos pasos el problema persiste:

1. Revisa los logs del backend en Railway
2. Verifica que todas las variables estén configuradas correctamente
3. Asegúrate de que el servicio PostgreSQL esté activo y funcionando
4. Verifica que la URL del frontend apunte correctamente al backend
