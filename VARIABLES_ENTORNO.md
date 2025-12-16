# Variables de Entorno - Klinip

Este documento explica todas las variables de entorno necesarias para ejecutar la aplicación Klinip en producción (Railway) y desarrollo local.

## 🔐 Variables de Entorno en Railway

### Para el Backend (Python/FastAPI)

Configura estas variables en el panel de Railway en la sección **Variables**:

#### 1. `SECRET_KEY` ⚠️ **OBLIGATORIO**

- **Descripción**: Clave secreta para firmar y verificar tokens JWT
- **Importancia**: **CRÍTICA** - Sin esta variable, la autenticación fallará
- **Cómo generar una clave segura**:
  ```bash
  python -c "import secrets; print(secrets.token_urlsafe(32))"
  ```
- **Ejemplo**: `SECRET_KEY=abc123xyz789...` (debe ser una cadena larga y aleatoria)
- **⚠️ ADVERTENCIA**:
  - NO uses la clave por defecto en producción
  - Si cambias esta clave, todos los tokens existentes se invalidarán
  - Mantén esta clave segura y nunca la subas a Git

#### 2. `DATABASE_URL` ⚠️ **OBLIGATORIO**

- **Descripción**: URL de conexión a la base de datos PostgreSQL
- **Railway**: Railway proporciona esta variable automáticamente cuando agregas un servicio PostgreSQL
- **Formato**: `postgresql://usuario:password@host:puerto/database`
- **Ejemplo**: `postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway`
- **Nota**:
  - El código automáticamente convierte `postgres://` a `postgresql://` si es necesario
  - **SSL**: El código automáticamente agrega `sslmode=require` para conexiones PostgreSQL en Railway (requerido por Railway)

#### 3. `ACCESS_TOKEN_EXPIRE_MINUTES` (Opcional)

- **Descripción**: Tiempo de expiración del token JWT en minutos
- **Valor por defecto**: `1440` (24 horas)
- **Ejemplo**: `ACCESS_TOKEN_EXPIRE_MINUTES=1440`

### Para el Frontend (Vite/React)

#### 1. `VITE_API_URL` ⚠️ **OBLIGATORIO EN PRODUCCIÓN**

- **Descripción**: URL base del backend API
- **En producción**: Debe ser la URL completa de tu backend en Railway
- **Ejemplo**: `VITE_API_URL=https://klinip-backend.up.railway.app`
- **Nota**:
  - En desarrollo local, si no está configurada, usa `http://localhost:8000`
  - En producción, si no está configurada, usa una URL relativa (puede causar problemas)

## 📋 Configuración en Railway

### Paso 1: Configurar Variables del Backend

1. Ve a tu proyecto en Railway
2. Selecciona el servicio del **Backend**
3. Ve a la pestaña **Variables**
4. Agrega las siguientes variables:

```
SECRET_KEY=<genera_una_clave_segura>
DATABASE_URL=<railway_proporciona_esto_automáticamente>
```

### Paso 2: Configurar Variables del Frontend (si está en un servicio separado)

Si tu frontend está en un servicio separado en Railway:

1. Ve a tu proyecto en Railway
2. Selecciona el servicio del **Frontend**
3. Ve a la pestaña **Variables**
4. Agrega:

```
VITE_API_URL=https://tu-backend.up.railway.app
```

**Nota**: Si el frontend y backend están en el mismo servicio (como en tu configuración actual con nixpacks), solo necesitas configurar las variables del backend.

## 🗄️ Configuración de Base de Datos PostgreSQL

### En Railway:

1. Agrega un servicio **PostgreSQL** a tu proyecto
2. Railway automáticamente crea la variable `DATABASE_URL`
3. Las tablas se crean automáticamente cuando el backend inicia (ver `main.py` línea 15)

### Variables de Base de Datos (si las necesitas manualmente):

Si Railway no proporciona `DATABASE_URL` automáticamente, necesitarás:

- `POSTGRES_HOST`: Host de la base de datos
- `POSTGRES_PORT`: Puerto (generalmente 5432)
- `POSTGRES_USER`: Usuario
- `POSTGRES_PASSWORD`: Contraseña
- `POSTGRES_DB`: Nombre de la base de datos

Y construir la URL manualmente:

```
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}
```

## 🔍 Verificación

### Verificar que las variables están configuradas:

1. **Backend Health Check**: Visita `https://tu-backend.up.railway.app/health`

   - Debe mostrar `"status": "ok"` y `"database": "ok"`

2. **Verificar SECRET_KEY**:
   - Si el login funciona pero `/me` falla con 401, el `SECRET_KEY` probablemente está mal configurado
   - Asegúrate de que el `SECRET_KEY` sea el mismo que se usó para generar los tokens

## 🐛 Solución de Problemas

### Error 401 "Token inválido o expirado"

**Causas comunes:**

1. ❌ `SECRET_KEY` no está configurado o es diferente al usado para generar el token
2. ❌ Token expirado (verifica `ACCESS_TOKEN_EXPIRE_MINUTES`)
3. ❌ Token no se está enviando correctamente en el header `Authorization`

**Solución:**

1. Verifica que `SECRET_KEY` esté configurado en Railway
2. Genera un nuevo token haciendo login nuevamente
3. Verifica que el frontend esté enviando el token en el header `Authorization: Bearer <token>`

### Error de conexión a base de datos

**Causas comunes:**

1. ❌ `DATABASE_URL` no está configurado
2. ❌ La base de datos PostgreSQL no está corriendo
3. ❌ Credenciales incorrectas

**Solución:**

1. Verifica que `DATABASE_URL` esté configurado en Railway
2. Verifica que el servicio PostgreSQL esté activo
3. Revisa los logs del backend para ver errores de conexión

## 📝 Resumen de Variables Requeridas

### Mínimo necesario para producción:

**Backend:**

- ✅ `SECRET_KEY` (generar una clave segura)
- ✅ `DATABASE_URL` (proporcionado por Railway automáticamente)

**Frontend:**

- ✅ `VITE_API_URL` (URL del backend en Railway)

### Opcionales:

- `ACCESS_TOKEN_EXPIRE_MINUTES` (por defecto 1440 minutos = 24 horas)
