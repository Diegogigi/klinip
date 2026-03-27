# Landing Prelaunch Klinip

Esta carpeta es un proyecto separado de la app principal.

## Objetivo

- Desplegar una landing de pre-lanzamiento en Railway
- Mantener `frontend/` y la app actual intactas
- Publicar la landing en un subdominio separado, por ejemplo `espera.klinip.cl`

## Configuracion rapida

Edita `config.js` y completa:

- `waitlistUrl`
- `paymentUrl` o los links separados `plusPlanUrl` y `familyPlanUrl`
- `whatsappUrl`
- `emailUrl`

## Despliegue recomendado en Railway

1. Crear un servicio nuevo desde este mismo repositorio.
2. En el servicio nuevo, fijar `Root Directory` a `landing-prelaunch`.
3. Railway detectara el `Dockerfile` de esta carpeta.
4. Agregar dominio personalizado `espera.klinip.cl`.
5. En Cloudflare crear un `CNAME`:
   - `Name`: `espera`
   - `Target`: el dominio que entregue Railway
6. Verificar SSL y dejar `www.klinip.cl` intacto apuntando a la app.

## Estructura

- `index.html`: landing publica
- `styles.css`: estilos responsive con soporte light/dark
- `script.js`: tema y enlaces configurables
- `config.js`: enlaces editables sin tocar el resto
- `Dockerfile`: despliegue estatico para Railway
