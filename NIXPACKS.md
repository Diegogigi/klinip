# IMPORTANTE: Esta aplicación usa NIXPACKS

Esta aplicación DEBE usar `nixpacks.toml` para el build y deployment.

**NO usar:**
- ❌ Procfile
- ❌ start.sh
- ❌ railway.json

**SÍ usar:**
- ✅ nixpacks.toml (único archivo de configuración)

El comando de inicio está definido en `nixpacks.toml` en la sección `[start]`.

