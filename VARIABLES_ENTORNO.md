# Variables de Entorno - Klinip

Este documento resume las variables de entorno necesarias para ejecutar Klinip
en desarrollo y en produccion.

## Backend

Variables recomendadas en Railway:

```env
SECRET_KEY=<genera_una_clave_segura>
DATABASE_URL=<railway_la_provee_o_configurala_manualmente>
ALLOWED_ORIGINS=https://app.klinip.cl,https://www.klinip.cl
FRONTEND_BASE_URL=https://app.klinip.cl
ACCESS_TOKEN_EXPIRE_MINUTES=1440
```

Variables de correo:

```env
EMAIL_PROVIDER=auto
RESEND_API_KEY=
MAIL_FROM_SECURITY=Klinip Seguridad <seguridad@klinip.cl>
MAIL_FROM_NOTIFICATIONS=Klinip Notificaciones <notificaciones@klinip.cl>
SUPPORT_EMAIL=soporte@klinip.cl
EMAIL_API_TIMEOUT=20
```

Variables de push:

```env
VAPID_PUBLIC_KEY=<clave_publica_nueva>
VAPID_PRIVATE_KEY=<clave_privada_nueva>
VAPID_EMAIL=mailto:soporte@klinip.cl
```

## Frontend

Si el frontend se construye en un servicio separado, configura:

```env
VITE_API_URL=https://tu-backend.up.railway.app
VITE_VAPID_PUBLIC_KEY=<misma_clave_publica_del_backend>
```

## Reglas de produccion

- `SECRET_KEY` debe existir y no puede usar un fallback conocido.
- `ALLOWED_ORIGINS` es obligatorio en produccion.
- `ALLOWED_ORIGINS` debe contener solo dominios reales del frontend, separados por comas.
- `VAPID_PUBLIC_KEY` y `VITE_VAPID_PUBLIC_KEY` deben ser iguales.
- `VAPID_PRIVATE_KEY` solo debe existir en backend.

## Ejemplo de `ALLOWED_ORIGINS`

```env
ALLOWED_ORIGINS=https://app.klinip.cl,https://www.klinip.cl
```

No uses:

```env
ALLOWED_ORIGINS=*
```

## Verificacion minima

1. El backend arranca en Railway.
2. El frontend puede consumir la API desde el dominio oficial.
3. Un origen no autorizado no recibe headers CORS validos.
4. Login, `/me` y las rutas protegidas responden bien desde el frontend real.
