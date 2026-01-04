from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Enum,
    Text,
    ForeignKey,
    JSON,
    LargeBinary,
    Boolean,
)
from sqlalchemy.orm import relationship

from .database import Base
import enum


class AppointmentType(str, enum.Enum):
    cita = "cita"
    examen = "examen"
    tramite = "tramite"


class AppointmentStatus(str, enum.Enum):
    pendiente = "pendiente"
    agendada = "agendada"
    realizada = "realizada"


class DocumentType(str, enum.Enum):
    receta = "receta"
    orden = "orden"
    resultado = "resultado"
    informe = "informe"
    otro = "otro"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    timezone = Column(String, default="America/Santiago")
    notifications_consent = Column(String, default="")
    notifications_last_prompt = Column(DateTime, nullable=True)
    data_consent_revoked = Column(Boolean, default=False)
    deleted = Column(Boolean, default=False)

    appointments = relationship(
        "Appointment", back_populates="user", cascade="all, delete-orphan"
    )
    documents = relationship(
        "Document", back_populates="user", cascade="all, delete-orphan"
    )


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    type = Column(Enum(AppointmentType), nullable=False)
    specialty = Column(String, default="")
    center = Column(String, default="")
    date_time = Column(DateTime, nullable=True)
    status = Column(Enum(AppointmentStatus), default=AppointmentStatus.pendiente)
    notes = Column(Text, nullable=True)
    checklist = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User", back_populates="appointments")
    documents = relationship("Document", back_populates="appointment")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    appointment_id = Column(Integer, ForeignKey("appointments.id"), nullable=True)
    doc_type = Column(Enum(DocumentType), nullable=False)
    file_path = Column(
        String, nullable=True
    )  # Mantener para compatibilidad con documentos antiguos
    file_data = Column(LargeBinary, nullable=True)  # Datos del archivo en la BD
    filename = Column(String, nullable=True)  # Nombre original del archivo
    date = Column(DateTime, default=datetime.now)
    center = Column(String, default="")
    notes = Column(Text, nullable=True)
    ocr_text = Column(Text, nullable=True)
    ocr_status = Column(String, default="pending")
    ocr_lang = Column(String, default="spa")
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User", back_populates="documents")
    appointment = relationship("Appointment", back_populates="documents")


class Medication(Base):
    __tablename__ = "medications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    name = Column(String, nullable=False)
    dose = Column(String, default="")
    frequency = Column(String, default="")
    duration = Column(String, default="")
    schedule_time = Column(String, default="")
    completed = Column(Boolean, default=False)
    end_date = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User")
    document = relationship("Document")


class MedicationIntake(Base):
    __tablename__ = "medication_intakes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    medication_id = Column(Integer, ForeignKey("medications.id"))
    taken_at = Column(DateTime, default=datetime.now)

    user = relationship("User")
    medication = relationship("Medication")


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    endpoint = Column(String, unique=True, nullable=False)
    p256dh = Column(String, nullable=False)
    auth = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User")


class PushNotificationLog(Base):
    __tablename__ = "push_notification_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    tag = Column(String, unique=True, nullable=False)
    kind = Column(String, nullable=False)
    trigger_at = Column(DateTime, nullable=False)
    sent_at = Column(DateTime, default=datetime.now)

    user = relationship("User")


class PrivacyRequest(Base):
    __tablename__ = "privacy_requests"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    reason = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    include_tech = Column(Boolean, default=False)
    user_email = Column(String, default="")
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User")


class PrivacyExportLog(Base):
    __tablename__ = "privacy_export_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    kind = Column(String, default="export")
    meta = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User")
