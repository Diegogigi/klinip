# Diagnostico y Solucion: `SECRET_KEY` obligatoria

## Problema

Si `SECRET_KEY` falta o usa un valor inseguro, el backend no debe iniciar.
Esto evita emitir o validar JWT con una clave conocida o vacia.

## Solucion rapida

### Paso 1: Generar una clave segura

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Paso 2: Configurar `SECRET_KEY` en Railway

1. Ve a Railway.
2. Abre el servicio donde corre Klinip.
3. En `Variables`, agrega o actualiza:
   - `SECRET_KEY=<tu_clave_segura>`
4. Guarda los cambios.

### Paso 3: Redeploy

1. Espera el redeploy automatico o ejecutalo manualmente.
2. Si `SECRET_KEY` cambio, los usuarios tendran que iniciar sesion de nuevo.

### Paso 4: Verificar

1. Abre la app.
2. Verifica login.
3. Verifica una ruta autenticada como `/me`.
4. En desarrollo, `/debug/config` debe mostrar `"secret_key_configured": true`.

## Checklist

- [ ] Genere una clave segura
- [ ] Configure `SECRET_KEY` en Railway
- [ ] Redeploy realizado
- [ ] Login verificado
- [ ] Ruta autenticada verificada

## Importante

- Nunca uses `supersecretkey_change_me_in_production`.
- Nunca subas `SECRET_KEY` a Git.
- Si cambias `SECRET_KEY`, todos los tokens actuales se invalidan.
