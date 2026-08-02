from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import (
    Date,
    Column,
    Integer,
    Float,
    String,
    DateTime,
    Enum,
    Text,
    ForeignKey,
    JSON,
    LargeBinary,
    Boolean,
    UniqueConstraint,
    Index,
    CheckConstraint,
    Time,
    text,
)
from sqlalchemy.orm import relationship, validates

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


class ClinicalEpisodeStatus(str, enum.Enum):
    active = "active"
    monitoring = "monitoring"
    resolved = "resolved"
    archived = "archived"


class ReminderState(str, enum.Enum):
    active = "active"
    awaiting_device = "awaiting_device"
    completed = "completed"
    cancelled = "cancelled"
    expired = "expired"
    failed = "failed"


class ReminderOccurrenceState(str, enum.Enum):
    scheduled = "scheduled"
    due = "due"
    snoozed = "snoozed"
    completed = "completed"
    dismissed = "dismissed"
    cancelled = "cancelled"
    expired = "expired"
    failed = "failed"


class ReminderDeliveryState(str, enum.Enum):
    queued = "queued"
    delivered = "delivered"
    announced = "announced"
    superseded = "superseded"
    failed = "failed"
    expired = "expired"
    cancelled = "cancelled"


class ReminderActorKind(str, enum.Enum):
    user = "user"
    device = "device"
    worker = "worker"


class ReminderEventScope(str, enum.Enum):
    reminder = "reminder"
    delivery = "delivery"
    occurrence = "occurrence"
    system = "system"


def _validated_enum_value(value, enum_type, field_name: str) -> str:
    raw_value = value.value if isinstance(value, enum_type) else value
    allowed = {item.value for item in enum_type}
    if raw_value not in allowed:
        raise ValueError(f"Invalid {field_name}")
    return raw_value


def _validated_timezone_iana(value: str) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError("Invalid timezone_iana")
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Invalid timezone_iana") from None
    return value


def _validated_weekdays(value, *, allow_empty: bool) -> list[int]:
    if not isinstance(value, list) or any(
        isinstance(day, bool) or not isinstance(day, int) for day in value
    ):
        raise ValueError("Invalid weekdays")
    if (not allow_empty and not value) or len(value) != len(set(value)):
        raise ValueError("Invalid weekdays")
    if any(day < 1 or day > 7 for day in value):
        raise ValueError("Invalid weekdays")
    return value


def _validated_recurrence(value) -> dict:
    if not isinstance(value, dict):
        raise ValueError("Invalid recurrence")
    if set(value) != {"version", "frequency", "interval", "weekdays"}:
        raise ValueError("Invalid recurrence")
    if value.get("version") != 1:
        raise ValueError("Invalid recurrence")
    frequency = value.get("frequency")
    if frequency not in {"once", "daily", "weekly"}:
        raise ValueError("Invalid recurrence")
    interval = value.get("interval")
    if isinstance(interval, bool) or not isinstance(interval, int) or interval <= 0:
        raise ValueError("Invalid recurrence")
    try:
        weekdays = _validated_weekdays(
            value.get("weekdays"),
            allow_empty=frequency != "weekly",
        )
    except ValueError:
        raise ValueError("Invalid recurrence") from None
    if frequency != "weekly" and weekdays:
        raise ValueError("Invalid recurrence")
    return {
        "version": 1,
        "frequency": frequency,
        "interval": interval,
        "weekdays": weekdays,
    }


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
    # Seguridad: bloqueo de cuenta por intentos fallidos
    failed_login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)
    # MFA / autenticación de dos factores
    mfa_enabled = Column(Boolean, default=False)
    mfa_secret = Column(String, nullable=True)          # TOTP base32 secret
    mfa_backup_codes_json = Column(Text, nullable=True)  # JSON: lista de hashes de códigos de respaldo
    chronic_condition = Column(String, default="")
    primary_care_center = Column(String, default="")
    reminder_preferred_time = Column(String, default="08:00")
    email_reminders_enabled = Column(Boolean, default=False)
    notification_settings_json = Column(Text, default="")
    plan_type = Column(String, default="basico")
    active_health_profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=True)
    family_ai_needs_refresh = Column(Boolean, default=False)
    family_ai_refresh_requested_at = Column(DateTime, nullable=True)
    family_ai_last_refreshed_at = Column(DateTime, nullable=True)
    # Bloqueo de la app con PIN (a nivel de cuenta, sincronizado entre dispositivos)
    app_pin_hash = Column(String, nullable=True)
    app_pin_enabled = Column(Boolean, default=False)

    @property
    def pin_set(self) -> bool:
        return bool(self.app_pin_hash)

    @property
    def pin_enabled(self) -> bool:
        return bool(self.app_pin_enabled and self.app_pin_hash)

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
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=True, index=True)
    episode_id = Column(Integer, ForeignKey("clinical_episodes.id"), nullable=True, index=True)
    type = Column(Enum(AppointmentType), nullable=False)
    specialty = Column(String, default="")
    center = Column(String, default="")
    date_time = Column(DateTime, nullable=True)
    status = Column(Enum(AppointmentStatus), default=AppointmentStatus.pendiente)
    notes = Column(Text, nullable=True)
    checklist = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User", back_populates="appointments")
    profile = relationship("HealthProfile")
    episode = relationship("ClinicalEpisode")
    documents = relationship("Document", back_populates="appointment")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=True, index=True)
    appointment_id = Column(Integer, ForeignKey("appointments.id"), nullable=True)
    episode_id = Column(Integer, ForeignKey("clinical_episodes.id"), nullable=True, index=True)
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
    profile = relationship("HealthProfile")
    appointment = relationship("Appointment", back_populates="documents")
    episode = relationship("ClinicalEpisode")


class Medication(Base):
    __tablename__ = "medications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=True, index=True)
    episode_id = Column(Integer, ForeignKey("clinical_episodes.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    dose = Column(String, default="")
    frequency = Column(String, default="")
    duration = Column(String, default="")
    schedule_time = Column(String, default="")
    start_at = Column(DateTime, nullable=True)
    refill_enabled = Column(Boolean, default=False)
    refill_mode = Column(String, default="rotativo")  # rotativo | fijo | manual
    refill_fixed_user_id = Column(Integer, nullable=True)
    refill_participants_json = Column(Text, nullable=True)
    doses_per_intake = Column(Float, default=1.0)
    frequency_per_day = Column(Float, default=1.0)
    stock_total_doses = Column(Integer, default=0)
    refill_alert_threshold_doses = Column(Integer, default=0)
    refill_rotation_index = Column(Integer, default=0)
    refill_last_notified_at = Column(DateTime, nullable=True)
    refill_last_notified_remaining = Column(Integer, nullable=True)
    completed = Column(Boolean, default=False)
    end_date = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User")
    profile = relationship("HealthProfile")
    episode = relationship("ClinicalEpisode")
    document = relationship("Document")


class MedicationPurchase(Base):
    __tablename__ = "medication_purchases"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    medication_id = Column(Integer, ForeignKey("medications.id"), nullable=False, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=True, index=True)
    episode_id = Column(Integer, ForeignKey("clinical_episodes.id"), nullable=True, index=True)
    assigned_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    purchased_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    medication_name_snapshot = Column(String, default="")
    dose_snapshot = Column(String, default="")
    assigned_name_snapshot = Column(String, default="")
    purchased_by_name_snapshot = Column(String, default="")
    quantity_added_doses = Column(Integer, default=0)
    previous_remaining_doses = Column(Integer, nullable=True)
    new_stock_total_doses = Column(Integer, default=0)
    amount_total = Column(Float, nullable=True)
    currency = Column(String, default="CLP")
    notes = Column(Text, nullable=True)
    receipt_filename = Column(String, nullable=True)
    receipt_mime_type = Column(String, nullable=True)
    receipt_file_data = Column(LargeBinary, nullable=True)
    purchased_at = Column(DateTime, default=datetime.now)
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User", foreign_keys=[user_id])
    medication = relationship("Medication")
    profile = relationship("HealthProfile")
    episode = relationship("ClinicalEpisode")
    assigned_user = relationship("User", foreign_keys=[assigned_user_id])
    purchased_by_user = relationship("User", foreign_keys=[purchased_by_user_id])


class MedicationIntake(Base):
    __tablename__ = "medication_intakes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    medication_id = Column(Integer, ForeignKey("medications.id"))
    scheduled_at = Column(DateTime, nullable=True)
    taken_at = Column(DateTime, nullable=True)
    status = Column(String, default="taken", index=True)
    source = Column(String, default="manual")
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User")
    medication = relationship("Medication")


class BiometricReading(Base):
    __tablename__ = "biometric_readings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    recorded_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    metric_type = Column(String, nullable=False, index=True)
    value_primary = Column(Float, nullable=False)
    value_secondary = Column(Float, nullable=True)
    unit = Column(String, default="")
    context = Column(String, default="")
    notes = Column(Text, nullable=True)
    measured_at = Column(DateTime, default=datetime.now, index=True)
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User", foreign_keys=[user_id])
    profile = relationship("HealthProfile")
    recorded_by_user = relationship("User", foreign_keys=[recorded_by_user_id])


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
    automation_settings_json = Column(Text, default="")
    is_primary_profile = Column(Boolean, default=False)
    is_archived = Column(Boolean, default=False)
    ai_needs_refresh = Column(Boolean, default=False)
    ai_refresh_requested_at = Column(DateTime, nullable=True)
    ai_last_refreshed_at = Column(DateTime, nullable=True)
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
    notes = relationship(
        "ProfileNote",
        back_populates="profile",
        cascade="all, delete-orphan",
    )
    clinical_episodes = relationship(
        "ClinicalEpisode",
        cascade="all, delete-orphan",
        foreign_keys="ClinicalEpisode.profile_id",
    )


class CoveragePreference(Base):
    __tablename__ = "coverage_preferences"
    __table_args__ = (UniqueConstraint("profile_id", name="uq_coverage_preferences_profile"),)

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    enabled = Column(Boolean, default=False)
    payer_type = Column(String, default="unknown")
    provider_name = Column(String, default="")
    plan_name = Column(String, default="")
    notes = Column(Text, default="")
    configured_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    profile = relationship("HealthProfile")
    owner_user = relationship("User", foreign_keys=[owner_user_id])
    configured_by_user = relationship("User", foreign_keys=[configured_by_user_id])


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

    # Permisos granulares: JSON array de strings de permisos otorgados explícitamente
    # Ejemplo: ["view_documents","download_documents","view_medications"]
    permissions_json = Column(Text, nullable=True)

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


class ProfileNote(Base):
    __tablename__ = "profile_notes"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    note = Column(Text, nullable=False)
    visibility = Column(String, default="shared")
    color = Column(String, default="yellow")
    reminder_at = Column(DateTime, nullable=True)
    reminder_sent = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    profile = relationship("HealthProfile", back_populates="notes")
    created_by_user = relationship("User")


class AiConversationMessage(Base):
    __tablename__ = "ai_conversation_messages"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    conversation_id = Column(String, nullable=False, index=True, default="")
    conversation_title = Column(String, default="")
    role = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now)

    profile = relationship("HealthProfile")
    user = relationship("User")


class AiConversationWorkflow(Base):
    __tablename__ = "ai_conversation_workflows"
    __table_args__ = (
        UniqueConstraint("conversation_id", name="uq_ai_conversation_workflows_conversation_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    conversation_id = Column(String, nullable=False, index=True, default="")
    workflow_type = Column(String, nullable=False, default="")
    status = Column(String, nullable=False, default="collecting")
    payload_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    profile = relationship("HealthProfile")
    user = relationship("User")


class AdherenceSummary(Base):
    __tablename__ = "adherence_summaries"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    medication_id = Column(Integer, ForeignKey("medications.id"), nullable=True, index=True)
    window_days = Column(Integer, default=30)
    adherence_rate = Column(Integer, default=0)
    missed_count = Column(Integer, default=0)
    late_count = Column(Integer, default=0)
    expected_doses = Column(Integer, default=0)
    taken_doses = Column(Integer, default=0)
    pattern_json = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    profile = relationship("HealthProfile")
    medication = relationship("Medication")


class HealthAlert(Base):
    __tablename__ = "health_alerts"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    alert_type = Column(String, nullable=False, index=True)
    severity = Column(String, default="low")
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    evidence_json = Column(JSON, default=dict)
    recommended_action = Column(Text, default="")
    status = Column(String, default="active", index=True)
    detected_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    profile = relationship("HealthProfile")


class DocumentSummary(Base):
    __tablename__ = "document_summaries"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, unique=True, index=True)
    document_type_inferred = Column(String, default="otro")
    summary_plain = Column(Text, default="")
    patient_friendly_explanation = Column(Text, default="")
    key_points_json = Column(JSON, default=list)
    abnormal_values_json = Column(JSON, default=list)
    requires_review = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    document = relationship("Document")


class DocumentClinicalEntity(Base):
    __tablename__ = "document_clinical_entities"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    entity_type = Column(String, nullable=False, index=True)
    entity_name = Column(String, default="")
    entity_value = Column(String, default="")
    unit = Column(String, default="")
    reference_range = Column(String, default="")
    flag = Column(String, default="unknown")
    confidence = Column(Integer, default=0)
    source_text = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.now)

    document = relationship("Document")


class DocumentCoverageInfo(Base):
    __tablename__ = "document_coverage_info"
    __table_args__ = (UniqueConstraint("document_id", name="uq_document_coverage_info_document"),)

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    category = Column(String, default="otro", index=True)
    payer_type = Column(String, default="unknown")
    provider_name = Column(String, default="")
    entity_name = Column(String, default="")
    amount_total = Column(Float, nullable=True)
    amount_covered = Column(Float, nullable=True)
    amount_patient = Column(Float, nullable=True)
    amount_reimbursed = Column(Float, nullable=True)
    currency = Column(String, default="CLP")
    status = Column(String, default="")
    issued_at = Column(DateTime, nullable=True)
    service_at = Column(DateTime, nullable=True)
    period_start_at = Column(DateTime, nullable=True)
    period_end_at = Column(DateTime, nullable=True)
    due_at = Column(DateTime, nullable=True)
    metadata_json = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    document = relationship("Document")
    profile = relationship("HealthProfile")
    owner_user = relationship("User")


class HealthProblem(Base):
    __tablename__ = "health_problems"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    detail = Column(Text, default="")
    status = Column(String, default="active", index=True)
    severity = Column(String, default="")
    source_type = Column(String, default="manual", index=True)
    source_id = Column(Integer, nullable=True, index=True)
    onset_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    updated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    profile = relationship("HealthProfile")
    owner_user = relationship("User", foreign_keys=[owner_user_id])
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])
    updated_by_user = relationship("User", foreign_keys=[updated_by_user_id])


class HealthVaccineRecord(Base):
    __tablename__ = "health_vaccine_records"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    vaccine_name = Column(String, nullable=False, index=True)
    dose_label = Column(String, default="")
    status = Column(String, default="documented", index=True)
    administered_at = Column(DateTime, nullable=True, index=True)
    next_due_at = Column(DateTime, nullable=True, index=True)
    provider_name = Column(String, default="")
    lot_number = Column(String, default="")
    source_type = Column(String, default="manual", index=True)
    source_id = Column(Integer, nullable=True, index=True)
    notes = Column(Text, default="")
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    updated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    profile = relationship("HealthProfile")
    owner_user = relationship("User", foreign_keys=[owner_user_id])
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])
    updated_by_user = relationship("User", foreign_keys=[updated_by_user_id])


class HealthExamResult(Base):
    __tablename__ = "health_exam_results"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    exam_name = Column(String, nullable=False, index=True)
    category = Column(String, default="")
    status = Column(String, default="documented", index=True)
    summary = Column(Text, default="")
    values_json = Column(JSON, default=list)
    performed_at = Column(DateTime, nullable=True, index=True)
    source_type = Column(String, default="manual", index=True)
    source_id = Column(Integer, nullable=True, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    updated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    profile = relationship("HealthProfile")
    owner_user = relationship("User", foreign_keys=[owner_user_id])
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])
    updated_by_user = relationship("User", foreign_keys=[updated_by_user_id])


class ClinicalReport(Base):
    __tablename__ = "clinical_reports"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    report_type = Column(String, default="consulta_medica", index=True)
    period_start = Column(DateTime, nullable=True)
    period_end = Column(DateTime, nullable=True)
    report_json = Column(JSON, default=dict)
    pdf_data = Column(LargeBinary, nullable=True)
    pdf_filename = Column(String, default="")
    created_at = Column(DateTime, default=datetime.now)

    profile = relationship("HealthProfile")


class ProfileHealthFeature(Base):
    __tablename__ = "profile_health_features"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, unique=True, index=True)
    next_appointment_at = Column(DateTime, nullable=True)
    last_appointment_at = Column(DateTime, nullable=True)
    active_medications_count = Column(Integer, default=0)
    low_adherence_risk = Column(Boolean, default=False)
    treatment_completion_score = Column(Integer, default=0)
    missing_documents_flags_json = Column(JSON, default=dict)
    extra_features_json = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    profile = relationship("HealthProfile")


class ProfileAiSummary(Base):
    __tablename__ = "profile_ai_summaries"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, unique=True, index=True)
    summary = Column(Text, default="")
    summary_json = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    profile = relationship("HealthProfile")


class FamilyAiSummary(Base):
    __tablename__ = "family_ai_summaries"
    __table_args__ = (
        UniqueConstraint("user_id", "window_days", name="uq_family_ai_summary_user_window"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    window_days = Column(Integer, default=30)
    family_size = Column(Integer, default=0)
    active_alerts_total = Column(Integer, default=0)
    pending_documents_total = Column(Integer, default=0)
    low_adherence_profiles = Column(Integer, default=0)
    summary = Column(Text, default="")
    profiles_json = Column(JSON, default=list)
    summary_json = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    user = relationship("User")


class AiConversationSummary(Base):
    __tablename__ = "ai_conversation_summaries"
    __table_args__ = (
        UniqueConstraint(
            "profile_id",
            "conversation_id",
            "summary_type",
            name="uq_ai_conversation_summaries_profile_conversation_type",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    conversation_id = Column(String, nullable=False, index=True, default="")
    summary_type = Column(String, default="rolling", index=True)
    event_type = Column(String, default="general", index=True)
    summary = Column(Text, default="")
    summary_json = Column(JSON, default=dict)
    source_message_count = Column(Integer, default=0)
    last_message_id = Column(Integer, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    user = relationship("User")
    profile = relationship("HealthProfile")


class AiDocumentChunk(Base):
    __tablename__ = "ai_document_chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", name="uq_ai_document_chunks_document_chunk"),
    )

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=True, index=True)
    document_type = Column(String, default="otro", index=True)
    chunk_index = Column(Integer, default=0)
    chunk_hash = Column(String, default="", index=True)
    chunk_text = Column(Text, default="")
    embedding_json = Column(JSON, default=list)
    embedding_model = Column(String, default="")
    embedding_source = Column(String, default="none")
    token_estimate = Column(Integer, default=0)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    document = relationship("Document")
    user = relationship("User")
    profile = relationship("HealthProfile")


class AiQueryMetric(Base):
    __tablename__ = "ai_query_metrics"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    conversation_id = Column(String, default="", index=True)
    query_type = Column(String, default="general", index=True)
    model = Column(String, default="")
    provider = Column(String, default="")
    mode = Column(String, default="")
    used_llm = Column(Boolean, default=False)
    cache_hit = Column(Boolean, default=False)
    structured_hit = Column(Boolean, default=False)
    history_messages = Column(Integer, default=0)
    chunk_count = Column(Integer, default=0)
    input_chars = Column(Integer, default=0)
    context_chars = Column(Integer, default=0)
    output_chars = Column(Integer, default=0)
    prompt_tokens_estimate = Column(Integer, default=0)
    output_tokens_estimate = Column(Integer, default=0)
    total_tokens_estimate = Column(Integer, default=0)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now, index=True)

    user = relationship("User")
    profile = relationship("HealthProfile")


class ExternalClinicalSource(Base):
    __tablename__ = "external_clinical_sources"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    source_type = Column(String, default="manual", index=True)
    source_name = Column(String, nullable=False)
    status = Column(String, default="connected", index=True)
    last_sync_at = Column(DateTime, nullable=True)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    profile = relationship("HealthProfile")


class ExternalClinicalRecord(Base):
    __tablename__ = "external_clinical_records"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    source_id = Column(Integer, ForeignKey("external_clinical_sources.id"), nullable=True, index=True)
    episode_id = Column(Integer, ForeignKey("clinical_episodes.id"), nullable=True, index=True)
    external_id = Column(String, default="", index=True)
    record_type = Column(String, default="lab_result", index=True)
    title = Column(String, nullable=False)
    summary = Column(Text, default="")
    payload_json = Column(JSON, default=dict)
    event_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    profile = relationship("HealthProfile")
    source = relationship("ExternalClinicalSource")
    episode = relationship("ClinicalEpisode")


class ClinicalEpisode(Base):
    __tablename__ = "clinical_episodes"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    episode_type = Column(String, default="general", index=True)
    status = Column(
        Enum(ClinicalEpisodeStatus),
        default=ClinicalEpisodeStatus.active,
        index=True,
    )
    source = Column(String, default="manual", index=True)
    started_at = Column(DateTime, nullable=True, index=True)
    last_activity_at = Column(DateTime, nullable=True, index=True)
    closed_at = Column(DateTime, nullable=True)
    summary = Column(Text, default="")
    care_summary = Column(Text, default="")
    tags_json = Column(JSON, default=list)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    profile = relationship("HealthProfile")
    owner_user = relationship("User")
    tasks = relationship(
        "ClinicalTask",
        back_populates="episode",
        cascade="all, delete-orphan",
    )


class ClinicalTask(Base):
    __tablename__ = "clinical_tasks"
    __table_args__ = (
        UniqueConstraint(
            "episode_id",
            "source_record_type",
            "source_record_id",
            "task_type",
            name="uq_clinical_task_source",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    episode_id = Column(Integer, ForeignKey("clinical_episodes.id"), nullable=False, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    task_type = Column(String, default="follow_up", index=True)
    title = Column(String, nullable=False)
    description = Column(Text, default="")
    status = Column(String, default="pending", index=True)
    due_at = Column(DateTime, nullable=True, index=True)
    completed_at = Column(DateTime, nullable=True)
    source_module = Column(String, default="", index=True)
    source_record_type = Column(String, default="", index=True)
    source_record_id = Column(Integer, nullable=True, index=True)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    episode = relationship("ClinicalEpisode", back_populates="tasks")
    profile = relationship("HealthProfile")
    owner_user = relationship("User")


# ─── Clinical Orchestrator — shadow logs ─────────────────────────────────────


class IntentShadowLog(Base):
    __tablename__ = "intent_shadow_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=True, index=True)
    conversation_id = Column(String, default="", index=True)
    source = Column(String, default="chat", index=True)
    message_preview = Column(String, default="")
    intent_predicted = Column(String, default="unknown", index=True)
    intent_source = Column(String, default="heuristic")
    confidence = Column(Float, default=0.0)
    used_llm_fallback = Column(Boolean, default=False)
    clinical_phase = Column(String, default="", index=True)
    clinical_urgency = Column(String, default="")
    primary_episode_id = Column(Integer, nullable=True)
    would_change_response = Column(Boolean, default=False, index=True)
    latency_ms = Column(Integer, default=0)
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now, index=True)

    user = relationship("User")
    profile = relationship("HealthProfile")


# ─── KlinipFeed ───────────────────────────────────────────────────────────────

class FeedPost(Base):
    __tablename__ = "feed_posts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    content = Column(Text, default="")
    post_type = Column(String, default="general")  # general | exam_result | doctor_visit | medication
    privacy = Column(String, default="family")      # family | private
    linked_document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    user = relationship("User")
    profile = relationship("HealthProfile")
    linked_document = relationship("Document")
    attachments = relationship("PostAttachment", back_populates="post", cascade="all, delete-orphan")
    reactions = relationship("PostReaction", back_populates="post", cascade="all, delete-orphan")
    comments = relationship("PostComment", back_populates="post", cascade="all, delete-orphan")
    mentions = relationship("PostMention", back_populates="post", cascade="all, delete-orphan")


class PostAttachment(Base):
    __tablename__ = "post_attachments"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("feed_posts.id"), nullable=False, index=True)
    attachment_type = Column(String, default="image")  # image | video | document | audio
    filename = Column(String, default="")
    file_data = Column(LargeBinary, nullable=True)
    created_at = Column(DateTime, default=datetime.now)

    post = relationship("FeedPost", back_populates="attachments")


class PostReaction(Base):
    __tablename__ = "post_reactions"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_reaction_user"),)

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("feed_posts.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    reaction_type = Column(String, default="like")  # like | heart | care
    created_at = Column(DateTime, default=datetime.now)

    post = relationship("FeedPost", back_populates="reactions")
    user = relationship("User")


class PostComment(Base):
    __tablename__ = "post_comments"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("feed_posts.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    parent_comment_id = Column(Integer, ForeignKey("post_comments.id"), nullable=True, index=True)
    content = Column(Text, nullable=False)
    mentions_json = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.now)

    post = relationship("FeedPost", back_populates="comments")
    user = relationship("User")
    likes = relationship("PostCommentLike", back_populates="comment", cascade="all, delete-orphan")


class PostCommentLike(Base):
    __tablename__ = "post_comment_likes"
    __table_args__ = (UniqueConstraint("comment_id", "user_id", name="uq_post_comment_like_user"),)

    id = Column(Integer, primary_key=True, index=True)
    comment_id = Column(Integer, ForeignKey("post_comments.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.now)

    comment = relationship("PostComment", back_populates="likes")
    user = relationship("User")


class PostMention(Base):
    __tablename__ = "post_mentions"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("feed_posts.id"), nullable=False, index=True)
    tagged_profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)

    post = relationship("FeedPost", back_populates="mentions")
    tagged_profile = relationship("HealthProfile")


# ─── Seguridad: Refresh Tokens ────────────────────────────────────────────────

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    device_label = Column(String, default="")    # User-Agent simplificado
    ip_address = Column(String, default="")
    expires_at = Column(DateTime, nullable=False)
    last_used_at = Column(DateTime, nullable=True)
    revoked = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)

    user = relationship("User")


# ─── Seguridad: Audit Log ─────────────────────────────────────────────────────

class StepUpEmailCode(Base):
    __tablename__ = "stepup_email_codes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    code_hash = Column(String, nullable=False, index=True)
    sent_to_email = Column(String, nullable=False, default="")
    expires_at = Column(DateTime, nullable=False, index=True)
    attempts = Column(Integer, default=0)
    used = Column(Boolean, default=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.now, index=True)

    user = relationship("User")


class VoiceSession(Base):
    __tablename__ = "voice_sessions"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.now)

    audio_consent = Column(String, nullable=True)   # path del archivo en filesystem
    audio_session = Column(String, nullable=True)   # path del archivo en filesystem
    audio_session_hash = Column(String, default="")

    transcripcion_tecnica = Column(Text, nullable=True)
    version_simple = Column(Text, nullable=True)
    indicaciones = Column(JSON, default=list)
    hablantes = Column(JSON, nullable=True)
    metadata_clinica = Column(JSON, nullable=True)

    compartido_en = Column(DateTime, nullable=True)
    link_seguro = Column(String, nullable=True)
    link_expira_en = Column(DateTime, nullable=True)

    user = relationship("User")
    profile = relationship("HealthProfile")


class VoiceFamilyShare(Base):
    __tablename__ = "voice_family_shares"
    __table_args__ = (
        UniqueConstraint("voice_session_id", "recipient_user_id", name="uq_voice_family_share_recipient"),
    )

    id = Column(Integer, primary_key=True, index=True)
    voice_session_id = Column(Integer, ForeignKey("voice_sessions.id"), nullable=False, index=True)
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=False, index=True)
    sender_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    recipient_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    share_mode = Column(String, default="manual")
    include_audio = Column(Boolean, default=True)
    message_title = Column(String, default="")
    sender_display_name = Column(String, default="")
    shared_summary = Column(Text, nullable=True)
    shared_indicaciones = Column(JSON, default=list)
    status = Column(String, default="active", index=True)
    shared_at = Column(DateTime, default=datetime.now, index=True)
    revoked_at = Column(DateTime, nullable=True)

    session = relationship("VoiceSession")
    profile = relationship("HealthProfile")
    sender_user = relationship("User", foreign_keys=[sender_user_id])
    recipient_user = relationship("User", foreign_keys=[recipient_user_id])


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    action = Column(String, nullable=False, index=True)   # login_ok, login_fail, mfa_enabled, doc_download…
    resource_type = Column(String, default="")            # document, medication, profile, account…
    resource_id = Column(Integer, nullable=True)
    ip_address = Column(String, default="")
    user_agent = Column(String, default="")
    metadata_json = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now, index=True)

    user = relationship("User")


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'revoked', 'disabled')",
            name="ck_devices_status",
        ),
        CheckConstraint("protocol_version > 0", name="ck_devices_protocol_version"),
    )

    id = Column(Integer, primary_key=True, index=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    label = Column(String(120), nullable=False)
    platform = Column(String(40), nullable=False)
    device_type = Column(String(40), nullable=False)
    protocol_version = Column(Integer, nullable=False, default=1)
    app_version = Column(String(40), nullable=True)
    status = Column(String(20), nullable=False, default="active", index=True)
    token_version = Column(Integer, nullable=False, default=1)
    metadata_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)
    last_seen_at = Column(DateTime, nullable=True, index=True)
    revoked_at = Column(DateTime, nullable=True)
    revoked_by_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    revoked_by_user = relationship("User", foreign_keys=[revoked_by_user_id])


class DevicePairing(Base):
    __tablename__ = "device_pairings"
    __table_args__ = (
        CheckConstraint(
            "pairing_status IN ('pending', 'claimed', 'expired', 'cancelled', 'locked')",
            name="ck_device_pairings_status",
        ),
        CheckConstraint("max_attempts > 0", name="ck_device_pairings_max_attempts"),
        CheckConstraint("attempts >= 0", name="ck_device_pairings_attempts"),
        CheckConstraint("protocol_version > 0", name="ck_device_pairings_protocol_version"),
        Index("ix_device_pairings_status_expires", "pairing_status", "expires_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    code_hash = Column(String(64), nullable=False, unique=True, index=True)
    requested_by_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    health_profile_id = Column(
        Integer,
        ForeignKey("health_profiles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    claimed_device_id = Column(
        Integer,
        ForeignKey("devices.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )
    requested_label = Column(String(120), nullable=True)
    requested_scopes = Column(JSON, nullable=False, default=list)
    expires_at = Column(DateTime, nullable=False, index=True)
    max_attempts = Column(Integer, nullable=False, default=5)
    attempts = Column(Integer, nullable=False, default=0)
    claimed_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    pairing_status = Column(String(20), nullable=False, default="pending", index=True)
    protocol_version = Column(Integer, nullable=False, default=1)

    requested_by_user = relationship("User", foreign_keys=[requested_by_user_id])
    health_profile = relationship("HealthProfile", foreign_keys=[health_profile_id])
    claimed_device = relationship("Device", foreign_keys=[claimed_device_id])


class DeviceCredential(Base):
    __tablename__ = "device_credentials"
    __table_args__ = (
        Index("ix_device_credentials_expires_revoked", "expires_at", "revoked_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(
        Integer,
        ForeignKey("devices.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    refresh_token_hash = Column(String(64), nullable=False, unique=True, index=True)
    token_family_id = Column(String(64), nullable=False, index=True)
    issued_at = Column(DateTime, nullable=False, default=datetime.now)
    expires_at = Column(DateTime, nullable=False, index=True)
    rotated_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True, index=True)
    replaced_by_id = Column(
        Integer,
        ForeignKey("device_credentials.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )
    reuse_detected_at = Column(DateTime, nullable=True)
    created_from_pairing_id = Column(
        Integer,
        ForeignKey("device_pairings.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    last_used_at = Column(DateTime, nullable=True)

    device = relationship("Device", foreign_keys=[device_id])
    replaced_by = relationship("DeviceCredential", remote_side=[id], foreign_keys=[replaced_by_id])
    created_from_pairing = relationship("DevicePairing", foreign_keys=[created_from_pairing_id])


class DeviceGrant(Base):
    __tablename__ = "device_grants"
    __table_args__ = (
        CheckConstraint("protocol_version > 0", name="ck_device_grants_protocol_version"),
        Index("ix_device_grants_device_profile", "device_id", "health_profile_id"),
        Index(
            "uq_device_grants_active",
            "device_id",
            "health_profile_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
            sqlite_where=text("revoked_at IS NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(
        Integer,
        ForeignKey("devices.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    health_profile_id = Column(
        Integer,
        ForeignKey("health_profiles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    granted_by_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    scopes_json = Column(JSON, nullable=False, default=list)
    protocol_version = Column(Integer, nullable=False, default=1)
    granted_at = Column(DateTime, nullable=False, default=datetime.now)
    expires_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True, index=True)
    revoked_by_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    reason = Column(String(120), nullable=True)

    device = relationship("Device", foreign_keys=[device_id])
    health_profile = relationship("HealthProfile", foreign_keys=[health_profile_id])
    granted_by_user = relationship("User", foreign_keys=[granted_by_user_id])
    revoked_by_user = relationship("User", foreign_keys=[revoked_by_user_id])


class DeviceMessage(Base):
    __tablename__ = "device_messages"
    __table_args__ = (
        CheckConstraint(
            "message_type IN ('family_non_clinical')",
            name="ck_device_messages_type",
        ),
        CheckConstraint("priority IN ('normal')", name="ck_device_messages_priority"),
        CheckConstraint("protocol_version > 0", name="ck_device_messages_protocol_version"),
        UniqueConstraint(
            "sender_user_id",
            "health_profile_id",
            "idempotency_key_hash",
            name="uq_device_messages_idempotency",
        ),
        Index("ix_device_messages_profile_created", "health_profile_id", "created_at"),
        Index("ix_device_messages_expires_at", "expires_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    health_profile_id = Column(
        Integer,
        ForeignKey("health_profiles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    sender_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    message_type = Column(String(40), nullable=False, default="family_non_clinical")
    body = Column(Text, nullable=False)
    priority = Column(String(20), nullable=False, default="normal")
    requires_acknowledgement = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    available_at = Column(DateTime, nullable=False, default=datetime.now)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    revoked_by_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    revocation_reason_code = Column(String(80), nullable=True)
    idempotency_key_hash = Column(String(64), nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    protocol_version = Column(Integer, nullable=False, default=1)
    metadata_json = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime, nullable=False, default=datetime.now, onupdate=datetime.now)

    health_profile = relationship("HealthProfile", foreign_keys=[health_profile_id])
    sender = relationship("User", foreign_keys=[sender_user_id])
    revoked_by_user = relationship("User", foreign_keys=[revoked_by_user_id])


class DeviceMessageRecipient(Base):
    __tablename__ = "device_message_recipients"
    __table_args__ = (
        CheckConstraint(
            "current_state IN ('queued', 'delivered', 'announced', 'heard', "
            "'acknowledged', 'failed', 'expired', 'revoked')",
            name="ck_device_message_recipients_state",
        ),
        UniqueConstraint(
            "message_id",
            "device_id",
            name="uq_device_message_recipients_message_device",
        ),
        Index(
            "ix_device_message_recipients_device_state_created",
            "device_id",
            "current_state",
            "created_at",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    message_id = Column(
        Integer,
        ForeignKey("device_messages.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    device_id = Column(
        Integer,
        ForeignKey("devices.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    revoked_at = Column(DateTime, nullable=True)
    current_state = Column(String(20), nullable=False, default="queued", index=True)
    current_state_at = Column(DateTime, nullable=False, default=datetime.now)
    delivery_attempts = Column(Integer, nullable=False, default=0)
    last_event_public_id = Column(String(64), nullable=True)
    version = Column(Integer, nullable=False, default=1)

    message = relationship("DeviceMessage", foreign_keys=[message_id])
    device = relationship("Device", foreign_keys=[device_id])


class DeviceMessageEvent(Base):
    __tablename__ = "device_message_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('delivered', 'announced', 'heard', 'acknowledged', 'failed')",
            name="ck_device_message_events_type",
        ),
        CheckConstraint("protocol_version > 0", name="ck_device_message_events_protocol_version"),
        UniqueConstraint(
            "recipient_id",
            "client_event_id",
            name="uq_device_message_events_recipient_client",
        ),
        Index("ix_device_message_events_message_server", "message_id", "server_timestamp"),
    )

    id = Column(Integer, primary_key=True, index=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    message_id = Column(
        Integer,
        ForeignKey("device_messages.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    recipient_id = Column(
        Integer,
        ForeignKey("device_message_recipients.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    device_id = Column(
        Integer,
        ForeignKey("devices.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    event_type = Column(String(20), nullable=False)
    client_event_id = Column(String(64), nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    resulting_state = Column(String(20), nullable=False)
    server_timestamp = Column(DateTime, nullable=False, default=datetime.now)
    client_timestamp = Column(DateTime, nullable=True)
    protocol_version = Column(Integer, nullable=False, default=1)
    error_code = Column(String(80), nullable=True)
    metadata_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=datetime.now)

    message = relationship("DeviceMessage", foreign_keys=[message_id])
    recipient = relationship("DeviceMessageRecipient", foreign_keys=[recipient_id])
    device = relationship("Device", foreign_keys=[device_id])


class ReminderProfileSettings(Base):
    __tablename__ = "reminder_profile_settings"
    __table_args__ = (
        UniqueConstraint(
            "health_profile_id",
            name="uq_reminder_profile_settings_profile",
        ),
        CheckConstraint(
            "settings_version > 0",
            name="ck_reminder_profile_settings_version",
        ),
        CheckConstraint(
            "NOT active_hours_enabled OR "
            "(active_hours_start_local IS NOT NULL AND "
            "active_hours_end_local IS NOT NULL)",
            name="ck_reminder_profile_settings_active_hours",
        ),
        Index(
            "ix_reminder_profile_settings_preferred_device",
            "preferred_device_id",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    health_profile_id = Column(
        Integer,
        ForeignKey("health_profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    timezone_iana = Column(String(80), nullable=False)
    preferred_device_id = Column(
        Integer,
        ForeignKey("devices.id", ondelete="RESTRICT"),
        nullable=True,
    )
    active_hours_enabled = Column(Boolean, nullable=False, default=True)
    active_hours_start_local = Column(Time, nullable=True)
    active_hours_end_local = Column(Time, nullable=True)
    active_weekdays_json = Column(JSON, nullable=False, default=list)
    settings_version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.now,
        onupdate=datetime.now,
    )

    __mapper_args__ = {"version_id_col": settings_version}

    health_profile = relationship("HealthProfile", foreign_keys=[health_profile_id])
    preferred_device = relationship("Device", foreign_keys=[preferred_device_id])

    @validates("timezone_iana")
    def validate_timezone_iana(self, _key, value):
        return _validated_timezone_iana(value)

    @validates("active_weekdays_json")
    def validate_active_weekdays(self, _key, value):
        return _validated_weekdays(value, allow_empty=True)


class Reminder(Base):
    __tablename__ = "reminders"
    __table_args__ = (
        CheckConstraint(
            "((created_by_user_id IS NOT NULL AND created_by_device_id IS NULL) OR "
            "(created_by_user_id IS NULL AND created_by_device_id IS NOT NULL))",
            name="ck_reminders_single_creator",
        ),
        CheckConstraint(
            "origin IN ('web', 'voice', 'authorized_caregiver')",
            name="ck_reminders_origin",
        ),
        CheckConstraint(
            "reminder_type IN ('personal_non_clinical')",
            name="ck_reminders_type",
        ),
        CheckConstraint(
            "schedule_mode IN ('wall_clock')",
            name="ck_reminders_schedule_mode",
        ),
        CheckConstraint(
            "dst_gap_policy IN ('shift_forward_by_gap')",
            name="ck_reminders_dst_gap_policy",
        ),
        CheckConstraint(
            "dst_fold_policy IN ('earlier')",
            name="ck_reminders_dst_fold_policy",
        ),
        CheckConstraint(
            "target_mode IN ('selected_device')",
            name="ck_reminders_target_mode",
        ),
        CheckConstraint(
            "state IN ('active', 'awaiting_device', 'completed', 'cancelled', "
            "'expired', 'failed')",
            name="ck_reminders_state",
        ),
        CheckConstraint("version > 0", name="ck_reminders_version"),
        CheckConstraint(
            "content_key_version > 0",
            name="ck_reminders_content_key_version",
        ),
        CheckConstraint(
            "length(idempotency_key_hash) = 64",
            name="ck_reminders_idempotency_hash_length",
        ),
        CheckConstraint(
            "length(request_fingerprint) = 64",
            name="ck_reminders_fingerprint_length",
        ),
        Index(
            "uq_reminders_user_idempotency",
            "created_by_user_id",
            "health_profile_id",
            "idempotency_key_hash",
            unique=True,
            postgresql_where=text("created_by_user_id IS NOT NULL"),
            sqlite_where=text("created_by_user_id IS NOT NULL"),
        ),
        Index(
            "uq_reminders_device_idempotency",
            "created_by_device_id",
            "health_profile_id",
            "idempotency_key_hash",
            unique=True,
            postgresql_where=text("created_by_device_id IS NOT NULL"),
            sqlite_where=text("created_by_device_id IS NOT NULL"),
        ),
        Index(
            "ix_reminders_profile_state_next",
            "health_profile_id",
            "state",
            "next_occurrence_at_utc",
        ),
        Index(
            "ix_reminders_target_state",
            "target_device_id",
            "state",
        ),
        Index(
            "ix_reminders_profile_created_public",
            "health_profile_id",
            "created_at",
            "public_id",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    health_profile_id = Column(
        Integer,
        ForeignKey("health_profiles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_by_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    created_by_device_id = Column(
        Integer,
        ForeignKey("devices.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    idempotency_key_hash = Column(String(64), nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    origin = Column(String(32), nullable=False)
    reminder_type = Column(
        String(32),
        nullable=False,
        default="personal_non_clinical",
    )
    title_ciphertext = Column(Text, nullable=False)
    body_ciphertext = Column(Text, nullable=True)
    content_nonce = Column(String(64), nullable=False)
    content_key_version = Column(Integer, nullable=False, default=1)
    schedule_mode = Column(String(24), nullable=False, default="wall_clock")
    original_local_date = Column(Date, nullable=True)
    original_local_time = Column(Time, nullable=False)
    timezone_iana = Column(String(80), nullable=False)
    recurrence_json = Column(JSON, nullable=False)
    dst_gap_policy = Column(
        String(32),
        nullable=False,
        default="shift_forward_by_gap",
    )
    dst_fold_policy = Column(String(16), nullable=False, default="earlier")
    target_mode = Column(String(24), nullable=False, default="selected_device")
    target_device_id = Column(
        Integer,
        ForeignKey("devices.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    next_occurrence_at_utc = Column(DateTime, nullable=True, index=True)
    next_logical_key = Column(String(120), nullable=True)
    state = Column(String(20), nullable=False, default=ReminderState.active.value)
    version = Column(Integer, nullable=False, default=1)
    expires_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.now,
        onupdate=datetime.now,
    )
    completed_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)

    __mapper_args__ = {"version_id_col": version}

    health_profile = relationship("HealthProfile", foreign_keys=[health_profile_id])
    created_by_user = relationship("User", foreign_keys=[created_by_user_id])
    created_by_device = relationship("Device", foreign_keys=[created_by_device_id])
    target_device = relationship("Device", foreign_keys=[target_device_id])

    @validates("timezone_iana")
    def validate_timezone_iana(self, _key, value):
        return _validated_timezone_iana(value)

    @validates("recurrence_json")
    def validate_recurrence_json(self, _key, value):
        return _validated_recurrence(value)

    @validates("state")
    def validate_state(self, _key, value):
        return _validated_enum_value(value, ReminderState, "reminder state")


class ReminderOccurrence(Base):
    __tablename__ = "reminder_occurrences"
    __table_args__ = (
        UniqueConstraint(
            "reminder_id",
            "schedule_version",
            "logical_occurrence_key",
            name="uq_reminder_occurrences_logical",
        ),
        CheckConstraint(
            "state IN ('scheduled', 'due', 'snoozed', 'completed', 'dismissed', "
            "'cancelled', 'expired', 'failed')",
            name="ck_reminder_occurrences_state",
        ),
        CheckConstraint(
            "schedule_version > 0",
            name="ck_reminder_occurrences_schedule_version",
        ),
        CheckConstraint(
            "revision > 0",
            name="ck_reminder_occurrences_revision",
        ),
        CheckConstraint(
            "snooze_count >= 0",
            name="ck_reminder_occurrences_snooze_count",
        ),
        Index(
            "ix_reminder_occurrences_state_scheduled",
            "state",
            "scheduled_for_utc",
            "id",
        ),
        Index(
            "ix_reminder_occurrences_profile_scheduled",
            "health_profile_id",
            "scheduled_for_utc",
            "public_id",
        ),
        Index(
            "ix_reminder_occurrences_reminder_created",
            "reminder_id",
            "created_at",
        ),
        Index(
            "ix_reminder_occurrences_state_updated",
            "state",
            "updated_at",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    reminder_id = Column(
        Integer,
        ForeignKey("reminders.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    health_profile_id = Column(
        Integer,
        ForeignKey("health_profiles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    schedule_version = Column(Integer, nullable=False)
    logical_occurrence_key = Column(String(120), nullable=False)
    original_scheduled_for_utc = Column(DateTime, nullable=False)
    scheduled_for_utc = Column(DateTime, nullable=False, index=True)
    original_local_date = Column(Date, nullable=False)
    original_local_time = Column(Time, nullable=False)
    timezone_iana = Column(String(80), nullable=False)
    tzdb_version = Column(String(40), nullable=True)
    revision = Column(Integer, nullable=False, default=1)
    snooze_count = Column(Integer, nullable=False, default=0)
    state = Column(
        String(20),
        nullable=False,
        default=ReminderOccurrenceState.scheduled.value,
    )
    due_at = Column(DateTime, nullable=True, index=True)
    terminal_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.now,
        onupdate=datetime.now,
    )

    reminder = relationship("Reminder", foreign_keys=[reminder_id])
    health_profile = relationship("HealthProfile", foreign_keys=[health_profile_id])

    @validates("timezone_iana")
    def validate_timezone_iana(self, _key, value):
        return _validated_timezone_iana(value)

    @validates("state")
    def validate_state(self, _key, value):
        return _validated_enum_value(
            value,
            ReminderOccurrenceState,
            "reminder occurrence state",
        )


class ReminderDelivery(Base):
    __tablename__ = "reminder_deliveries"
    __table_args__ = (
        UniqueConstraint(
            "occurrence_id",
            "device_id",
            "delivery_revision",
            name="uq_reminder_deliveries_occurrence_device_revision",
        ),
        CheckConstraint(
            "state IN ('queued', 'delivered', 'announced', 'superseded', "
            "'failed', 'expired', 'cancelled')",
            name="ck_reminder_deliveries_state",
        ),
        CheckConstraint(
            "delivery_revision > 0",
            name="ck_reminder_deliveries_revision",
        ),
        CheckConstraint(
            "occurrence_version > 0",
            name="ck_reminder_deliveries_occurrence_version",
        ),
        CheckConstraint(
            "delivery_attempts >= 0",
            name="ck_reminder_deliveries_attempts",
        ),
        CheckConstraint(
            "expires_at > available_at",
            name="ck_reminder_deliveries_expiry",
        ),
        Index(
            "ix_reminder_deliveries_device_state_available",
            "device_id",
            "state",
            "available_at",
            "public_id",
        ),
        Index(
            "ix_reminder_deliveries_occurrence_revision",
            "occurrence_id",
            "delivery_revision",
        ),
        Index(
            "ix_reminder_deliveries_device_expires",
            "device_id",
            "expires_at",
        ),
        Index(
            "ix_reminder_deliveries_profile_state_at",
            "health_profile_id",
            "state_at",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    occurrence_id = Column(
        Integer,
        ForeignKey("reminder_occurrences.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    health_profile_id = Column(
        Integer,
        ForeignKey("health_profiles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    device_id = Column(
        Integer,
        ForeignKey("devices.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    delivery_revision = Column(Integer, nullable=False, default=1)
    occurrence_version = Column(Integer, nullable=False)
    state = Column(
        String(20),
        nullable=False,
        default=ReminderDeliveryState.queued.value,
    )
    available_at = Column(DateTime, nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    delivery_attempts = Column(Integer, nullable=False, default=0)
    last_event_public_id = Column(String(64), nullable=True)
    state_at = Column(DateTime, nullable=False, default=datetime.now)
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.now,
        onupdate=datetime.now,
    )
    revoked_at = Column(DateTime, nullable=True)

    occurrence = relationship("ReminderOccurrence", foreign_keys=[occurrence_id])
    health_profile = relationship("HealthProfile", foreign_keys=[health_profile_id])
    device = relationship("Device", foreign_keys=[device_id])

    @validates("state")
    def validate_state(self, _key, value):
        return _validated_enum_value(
            value,
            ReminderDeliveryState,
            "reminder delivery state",
        )


class ReminderEvent(Base):
    __tablename__ = "reminder_events"
    __table_args__ = (
        CheckConstraint(
            "actor_kind IN ('user', 'device', 'worker')",
            name="ck_reminder_events_actor_kind",
        ),
        CheckConstraint(
            "((actor_kind = 'user' AND actor_user_id IS NOT NULL AND "
            "actor_device_id IS NULL AND client_event_id IS NOT NULL) OR "
            "(actor_kind = 'device' AND actor_user_id IS NULL AND "
            "actor_device_id IS NOT NULL AND client_event_id IS NOT NULL) OR "
            "(actor_kind = 'worker' AND actor_user_id IS NULL AND "
            "actor_device_id IS NULL))",
            name="ck_reminder_events_actor",
        ),
        CheckConstraint(
            "event_scope IN ('reminder', 'delivery', 'occurrence', 'system')",
            name="ck_reminder_events_scope",
        ),
        CheckConstraint(
            "((event_scope = 'reminder' AND occurrence_id IS NULL AND "
            "delivery_id IS NULL) OR "
            "(event_scope = 'occurrence' AND occurrence_id IS NOT NULL AND "
            "delivery_id IS NULL) OR "
            "(event_scope = 'delivery' AND occurrence_id IS NOT NULL AND "
            "delivery_id IS NOT NULL) OR event_scope = 'system')",
            name="ck_reminder_events_scope_target",
        ),
        CheckConstraint(
            "((event_scope = 'reminder' AND event_type IN ('updated', 'cancelled')) OR "
            "(event_scope = 'delivery' AND event_type IN "
            "('delivered', 'announced', 'failed')) OR "
            "(event_scope = 'occurrence' AND event_type IN "
            "('completed', 'snoozed', 'dismissed')) OR "
            "(event_scope = 'system' AND event_type IN "
            "('materialized', 'due', 'expired', 'cancelled', 'superseded')))",
            name="ck_reminder_events_scope_type",
        ),
        CheckConstraint(
            "resulting_version > 0",
            name="ck_reminder_events_resulting_version",
        ),
        CheckConstraint(
            "length(request_fingerprint) = 64",
            name="ck_reminder_events_fingerprint_length",
        ),
        Index(
            "uq_reminder_events_reminder_user_client",
            "reminder_id",
            "actor_user_id",
            "client_event_id",
            unique=True,
            postgresql_where=text(
                "event_scope = 'reminder' AND actor_user_id IS NOT NULL "
                "AND client_event_id IS NOT NULL"
            ),
            sqlite_where=text(
                "event_scope = 'reminder' AND actor_user_id IS NOT NULL "
                "AND client_event_id IS NOT NULL"
            ),
        ),
        Index(
            "uq_reminder_events_delivery_device_client",
            "delivery_id",
            "actor_device_id",
            "client_event_id",
            unique=True,
            postgresql_where=text(
                "event_scope = 'delivery' AND actor_device_id IS NOT NULL "
                "AND client_event_id IS NOT NULL"
            ),
            sqlite_where=text(
                "event_scope = 'delivery' AND actor_device_id IS NOT NULL "
                "AND client_event_id IS NOT NULL"
            ),
        ),
        Index(
            "uq_reminder_events_occurrence_user_client",
            "occurrence_id",
            "actor_user_id",
            "client_event_id",
            unique=True,
            postgresql_where=text(
                "event_scope = 'occurrence' AND actor_user_id IS NOT NULL "
                "AND client_event_id IS NOT NULL"
            ),
            sqlite_where=text(
                "event_scope = 'occurrence' AND actor_user_id IS NOT NULL "
                "AND client_event_id IS NOT NULL"
            ),
        ),
        Index(
            "uq_reminder_events_occurrence_device_client",
            "occurrence_id",
            "actor_device_id",
            "client_event_id",
            unique=True,
            postgresql_where=text(
                "event_scope = 'occurrence' AND actor_device_id IS NOT NULL "
                "AND client_event_id IS NOT NULL"
            ),
            sqlite_where=text(
                "event_scope = 'occurrence' AND actor_device_id IS NOT NULL "
                "AND client_event_id IS NOT NULL"
            ),
        ),
        Index(
            "ix_reminder_events_occurrence_server",
            "occurrence_id",
            "server_timestamp",
            "id",
        ),
        Index(
            "ix_reminder_events_delivery_server",
            "delivery_id",
            "server_timestamp",
            "id",
        ),
        Index(
            "ix_reminder_events_profile_server",
            "health_profile_id",
            "server_timestamp",
            "id",
        ),
        Index(
            "ix_reminder_events_actor_device_server",
            "actor_device_id",
            "server_timestamp",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    public_id = Column(String(64), nullable=False, unique=True, index=True)
    reminder_id = Column(
        Integer,
        ForeignKey("reminders.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    occurrence_id = Column(
        Integer,
        ForeignKey("reminder_occurrences.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    delivery_id = Column(
        Integer,
        ForeignKey("reminder_deliveries.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    health_profile_id = Column(
        Integer,
        ForeignKey("health_profiles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    actor_kind = Column(String(16), nullable=False)
    actor_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    actor_device_id = Column(
        Integer,
        ForeignKey("devices.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    event_scope = Column(String(16), nullable=False)
    event_type = Column(String(24), nullable=False)
    client_event_id = Column(String(64), nullable=True)
    request_fingerprint = Column(String(64), nullable=False)
    expected_version = Column(Integer, nullable=True)
    resulting_state = Column(String(20), nullable=False)
    resulting_version = Column(Integer, nullable=False)
    client_timestamp = Column(DateTime, nullable=True)
    server_timestamp = Column(DateTime, nullable=False, default=datetime.now)
    error_code = Column(String(80), nullable=True)
    metadata_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=datetime.now)

    reminder = relationship("Reminder", foreign_keys=[reminder_id])
    occurrence = relationship("ReminderOccurrence", foreign_keys=[occurrence_id])
    delivery = relationship("ReminderDelivery", foreign_keys=[delivery_id])
    health_profile = relationship("HealthProfile", foreign_keys=[health_profile_id])
    actor_user = relationship("User", foreign_keys=[actor_user_id])
    actor_device = relationship("Device", foreign_keys=[actor_device_id])

    @validates("actor_kind")
    def validate_actor_kind(self, _key, value):
        return _validated_enum_value(value, ReminderActorKind, "reminder actor kind")

    @validates("event_scope")
    def validate_event_scope(self, _key, value):
        return _validated_enum_value(value, ReminderEventScope, "reminder event scope")
