#!/bin/bash
set -e  # Salir si hay algún error

echo "=== Iniciando construcción de la aplicación ==="

# Construir el frontend
echo "Construyendo frontend..."
cd frontend
npm ci --production=false
npm run build
cd ..

# Crear directorio para archivos estáticos del frontend
echo "Copiando archivos estáticos..."
mkdir -p backend/static
if [ -d "frontend/dist" ]; then
    cp -r frontend/dist/* backend/static/
else
    echo "Error: frontend/dist no existe"
    exit 1
fi

# Ejecutar el backend
echo "Iniciando backend..."
cd backend
python -m pip install --upgrade pip --quiet
python -m pip install -r requirements.txt --quiet

# Usar el puerto proporcionado por Railway o 8000 por defecto
PORT=${PORT:-8000}
echo "Iniciando servidor en puerto $PORT"
python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT

