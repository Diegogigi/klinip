# Klinip - MiRutaSalud

Aplicación de gestión de salud personal.

## Despliegue en Railway

Esta aplicación usa **Nixpacks** para el build y deployment.

### Configuración:
- **Frontend**: React + Vite
- **Backend**: FastAPI + Python 3.11
- **Base de datos**: SQLite (SQLAlchemy)

### Archivo de configuración:
- `nixpacks.toml` - Define todas las fases de build y start

### Variables de entorno necesarias en Railway:
```
PORT - (auto configurado por Railway)
```

### Proceso de deployment:
1. **Install**: Instala dependencias de Node y Python
2. **Build**: Construye el frontend y lo copia a `backend/static/`
3. **Start**: Ejecuta uvicorn con el backend

El frontend se sirve desde el backend como archivos estáticos.

