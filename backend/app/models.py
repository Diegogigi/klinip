from datetime import datetime
from sqlalchemy import (
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
    profile_id = Column(Integer, ForeignKey("health_profiles.id"), nullable=True, index=True)
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
    profile = relationship("HealthProfile")
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
    start_at = Column(DateTime, nullable=True)
    refill_enabled = Column(Boolean, default=False)
    refill_mode = Column(String, default="rotativo")  # rotativo | fijo | manual
    refill_fixed_user_id = Column(Integer, nullable=True)
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
    document = relationship("Document")


class MedicationIntake(Base):
    __tablename__ = "medication_intakes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    medication_id = Column(Integer, ForeignKey("medications.id"))
    scheduled_at = Column(DateTime, nullable=True)
    taken_at = Column(DateTime, nullable=True, default=datetime.now)
    status = Column(String, default="taken", index=True)
    source = Column(String, default="manual")
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.now)

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
