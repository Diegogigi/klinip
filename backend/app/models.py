from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Enum, Text, ForeignKey, JSON, LargeBinary
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
    created_at = Column(DateTime, default=datetime.utcnow)

    appointments = relationship("Appointment", back_populates="user", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="user", cascade="all, delete-orphan")


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
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="appointments")
    documents = relationship("Document", back_populates="appointment")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    appointment_id = Column(Integer, ForeignKey("appointments.id"), nullable=True)
    doc_type = Column(Enum(DocumentType), nullable=False)
    file_path = Column(String, nullable=True)  # Mantener para compatibilidad con documentos antiguos
    file_data = Column(LargeBinary, nullable=True)  # Datos del archivo en la BD
    filename = Column(String, nullable=True)  # Nombre original del archivo
    date = Column(DateTime, default=datetime.utcnow)
    center = Column(String, default="")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

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
    end_date = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    document = relationship("Document")
