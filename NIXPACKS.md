# IMPORTANTE: Esta aplicacion usa Nixpacks

## Web
El proceso web usa `nixpacks.toml`.

Start command:
```txt
cd backend && venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

## Worker
El worker reutiliza el mismo build del repo, pero con start command manual en Railway:

```txt
cd backend && venv/bin/python -m app.worker
```

## Regla operativa
- No ejecutar tareas pesadas programadas dentro del proceso web por defecto.
- El worker es quien debe correr recordatorios, refresh IA y automatizaciones.
