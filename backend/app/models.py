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
    UniqueConstraint,
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
    token_version = Column(Integer, default=0)
    data_consent_revoked = Column(Boolean, default=False)
    deleted = Column(Boolean, default=False)
    chronic_condition = Column(String, default="")
    primary_care_center = Column(String, default="")
    reminder_preferred_time = Column(String, default="08:00")
    email_reminders_enabled = Column(Boolean, default=False)
    notification_settings_json = Column(Text, default="")
    plan_type = Column(String, default="basico")
    active_health_profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=True)

    appointments = relationship(
        "Appointment", back_populates="user", cascade="all, delete-orphan"
    )
    documents = relationship(
        "Document", back_populates="user", cascade="all, delete-orphan"
    )
    health_profiles_owned = relationship(
        "HealthProfile",
        back_populates="owner_user",
        foreign_keys="HealthProfile.owner_user_id",
        cascade="all, delete-orphan",
    )
    health_profile_links = relationship(
        "ProfileRelationship",
        back_populates="user",
        foreign_keys="ProfileRelationship.user_id",
        cascade="all, delete-orphan",
    )
    active_health_profile = relationship(
        "HealthProfile",
        foreign_keys=[active_health_profile_id],
        uselist=False,
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


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    token_hash = Column(String, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)

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


class HealthProfile(Base):
    __tablename__ = "health_profiles"

    id = Column(Integer, primary_key=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    full_name = Column(String, nullable=False)
    birth_date = Column(DateTime, nullable=True)
    gender = Column(String, default="")
    relation_with_owner = Column(String, default="")
    avatar_url = Column(String, default="")
    base_medical_data = Column(Text, nullable=True)
    is_primary_profile = Column(Boolean, default=False)
    is_archived = Column(Boolean, default=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.now)

    owner_user = relationship("User", foreign_keys=[owner_user_id], back_populates="health_profiles_owned")
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])
    relationships = relationship(
        "ProfileRelationship",
        back_populates="profile",
        cascade="all, delete-orphan",
        foreign_keys="ProfileRelationship.profile_id",
    )
    activity_logs = relationship(
        "ProfileActivityLog",
        back_populates="profile",
        cascade="all, delete-orphan",
    )


class ProfileRelationship(Base):
    __tablename__ = "profile_relationships"
    __table_args__ = (UniqueConstraint("profile_id", "user_id", name="uq_profile_user"),)

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    relationship_type = Column(String, default="")
    role = Column(String, default="admin")
    status = Column(String, default="accepted")
    invited_at = Column(DateTime, nullable=True)
    accepted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.now)

    profile = relationship("HealthProfile", back_populates="relationships", foreign_keys=[profile_id])
    user = relationship("User", back_populates="health_profile_links", foreign_keys=[user_id])


class ProfileActivityLog(Base):
    __tablename__ = "profile_activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    performed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    action_type = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now)

    profile = relationship("HealthProfile", back_populates="activity_logs")
    performed_by_user = relationship("User")


class ProfileInvitation(Base):
    __tablename__ = "profile_invitations"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    inviter_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    invitee_email = Column(String, nullable=False, index=True)
    role = Column(String, default="viewer")
    relationship_type = Column(String, default="")
    status = Column(String, default="pending")
    token = Column(String, unique=True, nullable=False, index=True)
    accepted_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    invited_at = Column(DateTime, default=datetime.now)
    accepted_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)

    profile = relationship("HealthProfile")
    inviter_user = relationship("User", foreign_keys=[inviter_user_id])
    accepted_by_user = relationship("User", foreign_keys=[accepted_by_user_id])
