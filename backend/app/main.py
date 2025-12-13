from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
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
    allow_headers=["*"],
)


# Auth endpoints
@app.post("/auth/register", response_model=schemas.UserOut)
def register(user_in: schemas.UserCreate, db: Session = Depends(auth.get_db)):
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


@app.post("/auth/login", response_model=schemas.Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(auth.get_db),
):
    user = auth.authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=400, detail="Correo o contraseña incorrectos")
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.id}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.get("/me", response_model=schemas.UserOut)
def read_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


# Appointments
@app.get("/appointments", response_model=List[schemas.AppointmentOut])
def list_appointments(
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
def create_appointment(
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
def update_appointment(
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
def delete_appointment(
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
def list_medications(
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
def create_medication(
    med_in: schemas.MedicationCreate,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    med = models.Medication(
        user_id=current_user.id,
        name=med_in.name,
        dose=med_in.dose,
        frequency=med_in.frequency,
        duration=med_in.duration,
        end_date=med_in.end_date,
        notes=med_in.notes,
        document_id=med_in.document_id,
    )
    db.add(med)
    db.commit()
    db.refresh(med)
    return med


@app.put("/medications/{medication_id}", response_model=schemas.MedicationOut)
def update_medication(
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
def delete_medication(
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
def list_documents(
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
    filename = f"{current_user.id}_{file.filename}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    with open(filepath, "wb") as buffer:
        buffer.write(await file.read())

    parsed_date = None
    if date:
        try:
            parsed_date = datetime.fromisoformat(date)
        except ValueError:
            parsed_date = None

    doc = models.Document(
        user_id=current_user.id,
        appointment_id=appointment_id,
        doc_type=models.DocumentType(doc_type),
        file_path=filepath,
        date=parsed_date,
        center=center or "",
        notes=notes or "",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@app.delete("/documents/{document_id}")
def delete_document(
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


# Servir archivos subidos
app.mount("/uploaded_docs", StaticFiles(directory=UPLOAD_DIR), name="uploaded_docs")

# Servir archivos estáticos del frontend
static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
    
    # Ruta catch-all para el SPA del frontend
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Si es una ruta de API, no servir el SPA
        if full_path.startswith(("api/", "auth/", "appointments", "medications", "documents", "me", "uploaded_docs")):
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
