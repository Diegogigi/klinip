from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List
import os
from datetime import timedelta, datetime

from .database import Base, engine
from . import models, schemas, auth

# Crear las tablas
Base.metadata.create_all(bind=engine)

app = FastAPI(title="MiRutaSalud API")

# Configurar CORS
# En producción, permitir todos los orígenes (Railway puede usar diferentes dominios)
is_production = os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_PUBLIC_DOMAIN")
if is_production:
    # En producción, permitir todos los orígenes (sin credentials para compatibilidad)
    allow_origins = ["*"]
    allow_credentials = False
else:
    # En desarrollo, solo localhost
    allow_origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]
    allow_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*", "Authorization", "Content-Type"],
    expose_headers=["*"],
)


# Health check
@app.get("/health")
def health_check(db: Session = Depends(auth.get_db)):
    try:
        # Verificar conexión a la base de datos
        db.execute(text("SELECT 1"))
        db_status = "ok"

        # Contar usuarios
        from . import models

        user_count = db.query(models.User).count()
    except Exception as e:
        db_status = f"error: {str(e)}"
        user_count = 0

    # Verificar SECRET_KEY (sin exponerlo)
    secret_key_status = (
        "configurado"
        if auth.SECRET_KEY != "supersecretkey_change_me_in_production"
        else "NO CONFIGURADO (usando valor por defecto)"
    )
    is_production = os.getenv("RAILWAY_ENVIRONMENT") or os.getenv(
        "RAILWAY_PUBLIC_DOMAIN"
    )

    return {
        "status": "ok",
        "database": db_status,
        "user_count": user_count,
        "database_url": os.getenv("DATABASE_URL", "sqlite (default)")[:30] + "...",
        "secret_key": secret_key_status,
        "environment": "production" if is_production else "development",
    }


# Debug endpoint para verificar configuración
@app.get("/debug/config")
def debug_config():
    """Endpoint de debug para verificar configuración (sin exponer secretos)"""
    secret_key_configured = auth.SECRET_KEY != "supersecretkey_change_me_in_production"
    secret_key_length = len(auth.SECRET_KEY)
    is_production = os.getenv("RAILWAY_ENVIRONMENT") or os.getenv(
        "RAILWAY_PUBLIC_DOMAIN"
    )

    return {
        "secret_key_configured": secret_key_configured,
        "secret_key_length": secret_key_length,
        "secret_key_preview": (
            auth.SECRET_KEY[:10] + "..." if secret_key_configured else "NO CONFIGURADO"
        ),
        "algorithm": auth.ALGORITHM,
        "token_expire_minutes": auth.ACCESS_TOKEN_EXPIRE_MINUTES,
        "environment": "production" if is_production else "development",
        "database_url_configured": bool(os.getenv("DATABASE_URL")),
        "railway_environment": bool(is_production),
    }


# Debug endpoint (solo para desarrollo)
@app.get("/debug/users")
def debug_users(db: Session = Depends(auth.get_db)):
    """Endpoint de debug para ver usuarios (solo en desarrollo)"""
    from . import models

    users = db.query(models.User).all()
    return {
        "count": len(users),
        "users": [
            {
                "id": u.id,
                "email": u.email,
                "name": u.name,
                "has_password_hash": bool(u.password_hash),
                "password_hash_length": len(u.password_hash) if u.password_hash else 0,
            }
            for u in users
        ],
    }


# Debug endpoint para ver headers
@app.get("/debug/headers")
def debug_headers(request: Request):
    """Endpoint de debug para ver headers recibidos"""
    auth_header = request.headers.get("Authorization", "NO ENCONTRADO")
    return {
        "authorization": auth_header,
        "authorization_parts": (
            auth_header.split(" ") if auth_header != "NO ENCONTRADO" else None
        ),
        "all_headers": dict(request.headers),
        "method": request.method,
        "url": str(request.url),
    }


# Middleware para loggear todos los requests
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Middleware para loggear requests y headers"""
    auth_header = request.headers.get("Authorization")
    if auth_header:
        print(f"DEBUG middleware: Authorization header recibido: {auth_header[:30]}...")
    else:
        print(
            f"DEBUG middleware: NO hay Authorization header en request a {request.url.path}"
        )

    response = await call_next(request)
    return response


# Auth endpoints
@app.post("/auth/register", response_model=schemas.UserOut)
def register(user_in: schemas.UserCreate, db: Session = Depends(auth.get_db)):
    try:
        existing = auth.get_user_by_email(db, user_in.email)
        if existing:
            raise HTTPException(status_code=400, detail="El correo ya está registrado")

        user = models.User(
            email=user_in.email,
            password_hash=auth.get_password_hash(user_in.password),
            name=user_in.name,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error creating user: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error al crear usuario: {str(e)}")


@app.post("/auth/login", response_model=schemas.Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(auth.get_db),
):
    print(f"DEBUG: Intento de login con email: {form_data.username}")
    user = auth.authenticate_user(db, form_data.username, form_data.password)
    if not user:
        print(f"DEBUG: Autenticación fallida para: {form_data.username}")
        raise HTTPException(status_code=400, detail="Correo o contraseña incorrectos")
    print(f"DEBUG: Autenticación exitosa para usuario ID: {user.id}")
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    # JWT requiere que 'sub' sea una cadena, no un entero
    access_token = auth.create_access_token(
        data={"sub": str(user.id)}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.get("/me", response_model=schemas.UserOut)
async def read_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


# Appointments
@app.get("/appointments", response_model=List[schemas.AppointmentOut])
async def list_appointments(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return (
        db.query(models.Appointment)
        .filter(models.Appointment.user_id == current_user.id)
        .order_by(models.Appointment.date_time)
        .all()
    )


@app.post("/appointments", response_model=schemas.AppointmentOut)
async def create_appointment(
    appt_in: schemas.AppointmentCreate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    appt = models.Appointment(
        user_id=current_user.id,
        type=appt_in.type,
        specialty=appt_in.specialty,
        center=appt_in.center,
        date_time=appt_in.date_time,
        status=appt_in.status,
        notes=appt_in.notes,
        checklist=appt_in.checklist or [],
    )
    db.add(appt)
    db.commit()
    db.refresh(appt)
    return appt


@app.put("/appointments/{appointment_id}", response_model=schemas.AppointmentOut)
async def update_appointment(
    appointment_id: int,
    appt_in: schemas.AppointmentUpdate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    appt = (
        db.query(models.Appointment)
        .filter(
            models.Appointment.id == appointment_id,
            models.Appointment.user_id == current_user.id,
        )
        .first()
    )
    if not appt:
        raise HTTPException(status_code=404, detail="Cita no encontrada")

    for field, value in appt_in.dict(exclude_unset=True).items():
        setattr(appt, field, value)

    db.commit()
    db.refresh(appt)
    return appt


@app.delete("/appointments/{appointment_id}")
async def delete_appointment(
    appointment_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    appt = (
        db.query(models.Appointment)
        .filter(
            models.Appointment.id == appointment_id,
            models.Appointment.user_id == current_user.id,
        )
        .first()
    )
    if not appt:
        raise HTTPException(status_code=404, detail="Cita no encontrada")
    db.delete(appt)
    db.commit()
    return {"ok": True}


# Medications
@app.get("/medications", response_model=List[schemas.MedicationOut])
async def list_medications(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return (
        db.query(models.Medication)
        .filter(models.Medication.user_id == current_user.id)
        .order_by(models.Medication.created_at.desc())
        .all()
    )


@app.post("/medications", response_model=schemas.MedicationOut)
async def create_medication(
    med_in: schemas.MedicationCreate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        med = models.Medication(
            user_id=current_user.id,
            name=med_in.name,
            dose=med_in.dose or "",
            frequency=med_in.frequency or "",
            duration=med_in.duration or "",
            end_date=med_in.end_date,
            notes=med_in.notes or "",
            document_id=med_in.document_id,
        )
        db.add(med)
        db.commit()
        db.refresh(med)
        return med
    except Exception as e:
        db.rollback()
        print(f"Error al crear medicamento: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error al crear medicamento: {str(e)}"
        )


@app.put("/medications/{medication_id}", response_model=schemas.MedicationOut)
async def update_medication(
    medication_id: int,
    med_in: schemas.MedicationUpdate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    med = (
        db.query(models.Medication)
        .filter(
            models.Medication.id == medication_id,
            models.Medication.user_id == current_user.id,
        )
        .first()
    )
    if not med:
        raise HTTPException(status_code=404, detail="Medicamento no encontrado")

    for field, value in med_in.dict(exclude_unset=True).items():
        setattr(med, field, value)

    db.commit()
    db.refresh(med)
    return med


@app.delete("/medications/{medication_id}")
async def delete_medication(
    medication_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    med = (
        db.query(models.Medication)
        .filter(
            models.Medication.id == medication_id,
            models.Medication.user_id == current_user.id,
        )
        .first()
    )
    if not med:
        raise HTTPException(status_code=404, detail="Medicamento no encontrado")
    db.delete(med)
    db.commit()
    return {"ok": True}


# Documents
UPLOAD_DIR = "uploaded_docs"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.get("/documents", response_model=List[schemas.DocumentOut])
async def list_documents(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    docs = (
        db.query(models.Document)
        .filter(models.Document.user_id == current_user.id)
        .order_by(models.Document.created_at.desc())
        .all()
    )
    return docs


@app.post("/documents", response_model=schemas.DocumentOut)
async def upload_document(
    doc_type: str = Form(...),
    appointment_id: int | None = Form(None),
    date: str | None = Form(None),
    center: str | None = Form(""),
    notes: str | None = Form(""),
    file: UploadFile = File(...),
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    # Leer el contenido del archivo
    file_content = await file.read()
    original_filename = file.filename or "document"
    
    print(f"DEBUG upload_document: Subiendo archivo: {original_filename}, tamaño: {len(file_content)} bytes")

    parsed_date = None
    if date:
        try:
            parsed_date = datetime.fromisoformat(date)
        except ValueError:
            parsed_date = None

    # Guardar el archivo directamente en la base de datos como BLOB
    doc = models.Document(
        user_id=current_user.id,
        appointment_id=appointment_id,
        doc_type=models.DocumentType(doc_type),
        file_data=file_content,  # Guardar datos del archivo en la BD
        filename=original_filename,  # Guardar nombre original
        file_path=None,  # Ya no usamos file_path para archivos nuevos
        date=parsed_date,
        center=center or "",
        notes=notes or "",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    print(f"DEBUG upload_document: Documento guardado en BD con ID: {doc.id}, filename: {doc.filename}")
    return doc


@app.delete("/documents/{document_id}")
async def delete_document(
    document_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    doc = (
        db.query(models.Document)
        .filter(
            models.Document.id == document_id,
            models.Document.user_id == current_user.id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    # Borrar archivo físico
    if os.path.exists(doc.file_path):
        os.remove(doc.file_path)

    db.delete(doc)
    db.commit()
    return {"ok": True}


# Endpoint protegido para servir documentos
@app.get("/documents/{document_id}/file")
async def get_document_file(
    document_id: int,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Sirve un archivo de documento solo si el usuario tiene acceso"""
    import mimetypes

    print(
        f"DEBUG get_document_file: Solicitando documento ID {document_id} para usuario {current_user.id}"
    )

    doc = (
        db.query(models.Document)
        .filter(
            models.Document.id == document_id,
            models.Document.user_id == current_user.id,
        )
        .first()
    )

    if not doc:
        print(
            f"DEBUG get_document_file: Documento {document_id} no encontrado para usuario {current_user.id}"
        )
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    # Prioridad 1: Si el archivo está en la BD (file_data)
    if doc.file_data:
        print(f"DEBUG get_document_file: Sirviendo archivo desde BD, tamaño: {len(doc.file_data)} bytes")
        filename = doc.filename or f"document_{doc.id}"
        
        # Detectar el tipo MIME del archivo
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type:
            mime_type = "application/octet-stream"
        
        print(f"DEBUG get_document_file: Tipo MIME: {mime_type}, filename: {filename}")
        return Response(
            content=doc.file_data,
            media_type=mime_type,
            headers={"Content-Disposition": f'inline; filename="{filename}"'}
        )
    
    # Prioridad 2: Si el archivo está en el sistema de archivos (compatibilidad con documentos antiguos)
    if doc.file_path:
        print(f"DEBUG get_document_file: Intentando servir desde file_path: {doc.file_path}")
        
        # Intentar con ruta absoluta si es relativa
        file_path_to_check = doc.file_path
        if not os.path.isabs(file_path_to_check):
            file_path_to_check = os.path.abspath(file_path_to_check)
            print(f"DEBUG get_document_file: Convirtiendo a ruta absoluta: {file_path_to_check}")

        # También intentar con la ruta relativa original
        if not os.path.exists(file_path_to_check):
            # Intentar con la ruta relativa desde el directorio de trabajo
            relative_path = doc.file_path
            if not relative_path.startswith(UPLOAD_DIR):
                relative_path = os.path.join(UPLOAD_DIR, os.path.basename(doc.file_path))
            relative_path = os.path.abspath(relative_path)
            print(f"DEBUG get_document_file: Intentando ruta alternativa: {relative_path}")
            if os.path.exists(relative_path):
                file_path_to_check = relative_path
                print(f"DEBUG get_document_file: Archivo encontrado en ruta alternativa")

        if os.path.exists(file_path_to_check):
            # Detectar el tipo MIME del archivo
            mime_type, _ = mimetypes.guess_type(file_path_to_check)
            if not mime_type:
                mime_type = "application/octet-stream"
            
            print(f"DEBUG get_document_file: Sirviendo archivo desde sistema de archivos")
            return FileResponse(
                file_path_to_check,
                media_type=mime_type,
                filename=os.path.basename(file_path_to_check),
            )
        else:
            print(f"DEBUG get_document_file: Archivo no existe en file_path: {file_path_to_check}")

    # Si no hay archivo ni en BD ni en sistema de archivos
    print(f"DEBUG get_document_file: No se encontró archivo para el documento {document_id}")
    raise HTTPException(status_code=404, detail="Archivo no encontrado")


# Servir archivos subidos (mantener para compatibilidad, pero usar endpoint protegido)
# app.mount("/uploaded_docs", StaticFiles(directory=UPLOAD_DIR), name="uploaded_docs")

# Servir archivos estáticos del frontend
static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    # Ruta catch-all para el SPA del frontend
    # IMPORTANTE: Esta ruta debe estar al final para no interceptar rutas de API
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Si es una ruta de API, no servir el SPA (dejar que FastAPI maneje el 404)
        # IMPORTANTE: NO interceptar rutas que terminan en /file (para documentos)
        # Estas deben ser manejadas por el endpoint específico /documents/{id}/file
        if "/file" in full_path:
            raise HTTPException(status_code=404, detail="Not found")

        # Rutas de API que deben ser excluidas del SPA
        api_routes = (
            "api/",
            "auth/",
            "appointments",
            "medications",
            "me",
            "uploaded_docs",
            "health",
            "debug",
        )
        # Solo interceptar si empieza con estas rutas
        if full_path.startswith(api_routes) or full_path in ("health", "debug"):
            raise HTTPException(status_code=404, detail="Not found")

        # Para "documents", solo interceptar si es exactamente "documents" o "documents/" sin más segmentos
        # Las rutas como "/documents/{id}/file" ya fueron manejadas arriba
        if full_path == "documents" or full_path == "documents/":
            raise HTTPException(status_code=404, detail="Not found")

        # Intentar servir el archivo solicitado
        file_path = os.path.join(static_dir, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)

        # Si no existe, servir index.html (para rutas del SPA)
        index_path = os.path.join(static_dir, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)

        raise HTTPException(status_code=404, detail="Not found")
