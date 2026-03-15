# Klinip - MiRutaSalud

Aplicacion de gestion de salud personal.

## Despliegue en Railway

Esta aplicacion usa **Nixpacks** para build y deployment.

### Stack
- Frontend: React + Vite
- Backend: FastAPI + Python 3.11
- Base de datos: PostgreSQL en Railway o SQLite local

### Configuracion principal
- `nixpacks.toml` define el build y el proceso web
- `backend/app/worker.py` ejecuta el worker de background

### Variables de entorno utiles
```txt
PORT
ENABLE_EMBEDDED_SCHEDULER=false
WORKER_INTERVAL_SECONDS=60
```

### Arquitectura recomendada
Usa dos servicios en Railway:

1. Web
```txt
cd backend && venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

2. Worker
```txt
cd backend && venv/bin/python -m app.worker
```

### Regla
- El proceso web debe responder rutas HTTP.
- El worker debe ejecutar recordatorios, refresh IA y automatizaciones programadas.

### Flujo
1. Install: instala dependencias de Node y Python
2. Build: construye el frontend y lo copia a `backend/static/`
3. Web: sirve la aplicacion
4. Worker: procesa tareas de background
