# Configuracion de Variables de Entorno en Railway

## Objetivo

Este archivo documenta la configuracion segura de push en Railway sin publicar
secretos dentro del repositorio.

## Variables requeridas

Configura estas variables en Railway, en `Settings -> Variables`:

```env
VAPID_PUBLIC_KEY=<rota_esta_clave_publica>
VAPID_PRIVATE_KEY=<rota_esta_clave_privada>
VAPID_EMAIL=mailto:soporte@klinip.cl
VITE_VAPID_PUBLIC_KEY=<rota_esta_clave_publica>
```

Notas:

- `VAPID_PUBLIC_KEY` y `VITE_VAPID_PUBLIC_KEY` deben tener el mismo valor.
- `VAPID_PRIVATE_KEY` solo debe existir en backend.
- Las claves antiguas publicadas en este repo deben considerarse comprometidas y
  quedar fuera de uso.

## Generar nuevas claves VAPID

Opcion recomendada con Node:

```bash
npx web-push generate-vapid-keys
```

Opcion con Python:

```bash
python -m pip install pywebpush
python -c "from py_vapid import Vapid01 as Vapid; k = Vapid(); k.generate_keys(); print('public=' + k.public_key.public_bytes().decode()); print('private=' + k.private_key.private_bytes().decode())"
```

Si usas la opcion de Python, valida primero el formato antes de cargarlo en
Railway.

## Carga en Railway

1. Genera un juego nuevo de claves.
2. Carga `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_EMAIL` en el servicio backend.
3. Carga `VITE_VAPID_PUBLIC_KEY` en el servicio que construye el frontend.
4. Fuerza un redeploy.
5. Rehabilita push en un navegador de prueba para registrar una nueva suscripcion.

## Verificacion

Checklist minimo:

- La app construye sin errores.
- El backend responde sin error al consultar configuracion de notificaciones.
- El navegador puede suscribirse nuevamente a push.
- La notificacion de prueba llega al dispositivo.
- No quedan claves antiguas visibles en documentacion ni archivos de ejemplo.

## Rotacion operativa recomendada

1. Generar nuevas claves.
2. Cargarlas en Railway.
3. Desplegar backend y frontend.
4. Invalidar y dejar de usar las claves antiguas.
5. Pedir a usuarios de prueba que reactiven push si es necesario.
