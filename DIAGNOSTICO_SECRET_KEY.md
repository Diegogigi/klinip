# Diagnóstico y Solución: Error "Token expirado" inmediatamente después del login

## 🔍 Problema

Después de hacer login, aparece el error "Token inválido o expirado" inmediatamente. Esto indica que el `SECRET_KEY` no está configurado correctamente en Railway.

## ✅ Solución Rápida

### Paso 1: Verificar el estado actual

Visita estos endpoints en tu aplicación desplegada:

1. **Health Check**: `https://tu-backend.up.railway.app/health`

   - Busca el campo `"secret_key"` en la respuesta
   - Si dice `"NO CONFIGURADO"`, necesitas configurar `SECRET_KEY`

2. **Debug Config**: `https://tu-backend.up.railway.app/debug/config`
   - Verifica `"secret_key_configured": false` o `true`
   - Si es `false`, el problema está confirmado

### Paso 2: Generar una clave secreta

Ejecuta este comando en tu terminal local (o en Railway):

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Esto generará una clave como: `abc123xyz789...` (copia esta clave completa)

### Paso 3: Configurar SECRET_KEY en Railway

1. Ve a [Railway](https://railway.app)
2. Selecciona tu proyecto
3. Selecciona el servicio del **Backend**
4. Ve a la pestaña **Variables**
5. Haz clic en **+ New Variable**
6. Agrega:
   - **Nombre**: `SECRET_KEY`
   - **Valor**: Pega la clave que generaste en el Paso 2
7. Guarda los cambios

### Paso 4: Reiniciar el servicio

Después de agregar la variable:

1. Railway debería detectar el cambio y redesplegar automáticamente
2. O puedes ir a **Deployments** → **Redeploy**
3. Espera 1-2 minutos a que termine el despliegue

### Paso 5: Verificar que funciona

1. **Verifica el health check nuevamente**:

   - `https://tu-backend.up.railway.app/health`
   - Ahora debe mostrar `"secret_key": "configurado"`

2. **Limpia el localStorage del navegador**:

   - Abre las herramientas de desarrollador (F12)
   - Ve a la consola
   - Ejecuta: `localStorage.clear()`

3. **Intenta hacer login nuevamente**:
   - El token ahora debería funcionar correctamente

## 🔍 Diagnóstico Detallado

### Verificar logs del backend

En Railway, ve a los logs del backend y busca:

- `⚠️ ADVERTENCIA: SECRET_KEY no está configurado` → Confirma que falta la variable
- `DEBUG create_access_token: SECRET_KEY configurado: Sí/NO` → Muestra el estado al generar tokens
- `DEBUG get_current_user: SECRET_KEY configurado: Sí/NO` → Muestra el estado al validar tokens

### Problemas comunes

1. **SECRET_KEY no configurado**:

   - Síntoma: Token se genera pero falla al validar
   - Solución: Configurar `SECRET_KEY` en Railway

2. **SECRET_KEY diferente entre generación y validación**:

   - Síntoma: Tokens generados antes de configurar SECRET_KEY no funcionan
   - Solución: Los usuarios deben hacer login nuevamente después de configurar SECRET_KEY

3. **SECRET_KEY con caracteres especiales**:
   - Síntoma: Errores al decodificar tokens
   - Solución: Usar `secrets.token_urlsafe()` que genera claves seguras sin caracteres problemáticos

## 📋 Checklist

- [ ] Visité `/health` y verifiqué el estado de `secret_key`
- [ ] Visité `/debug/config` y confirmé que `secret_key_configured` es `false`
- [ ] Generé una nueva clave con `python -c "import secrets; print(secrets.token_urlsafe(32))"`
- [ ] Agregué `SECRET_KEY` en Railway con la clave generada
- [ ] Esperé a que Railway redesplegara
- [ ] Verifiqué `/health` nuevamente y confirmé que `secret_key` es "configurado"
- [ ] Limpié el localStorage del navegador
- [ ] Intenté hacer login nuevamente

## ⚠️ Importante

- **NUNCA** uses la clave por defecto `supersecretkey_change_me_in_production` en producción
- **NUNCA** subas el `SECRET_KEY` a Git o lo compartas públicamente
- Si cambias el `SECRET_KEY`, todos los tokens existentes se invalidarán (los usuarios deben hacer login nuevamente)

## 🔗 Referencias

- Ver `SOLUCION_ERROR_401.md` para más detalles sobre el error 401
- Ver `VARIABLES_ENTORNO.md` para documentación completa de variables
