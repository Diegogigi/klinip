from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, EmailStr, field_serializer
from .models import AppointmentType, AppointmentStatus, ClinicalEpisodeStatus, DocumentType


def _serialize_datetime_preserving_offset(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if getattr(dt, "tzinfo", None) is not None:
        return dt.isoformat(timespec="seconds")
    return dt.strftime('%Y-%m-%dT%H:%M:%S')


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str


class UserOut(BaseModel):
    id: int
    email: EmailStr
    name: str
    timezone: str | None = None
    notifications_consent: str | None = None
    notifications_last_prompt: datetime | None = None
    data_consent_revoked: bool | None = None
    deleted: bool | None = None
    chronic_condition: str | None = None
    primary_care_center: str | None = None
    reminder_preferred_time: str | None = None
    email_reminders_enabled: bool | None = None
    notification_settings_json: str | None = None
    plan_type: str | None = None
    active_health_profile_id: int | None = None
    pin_set: bool = False
    pin_enabled: bool = False
    created_at: datetime

    @field_serializer('created_at', 'notifications_last_prompt')
    def serialize_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        # Serializar en formato ISO sin conversión a UTC
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True




class UserUpdate(BaseModel):
    name: Optional[str] = None
    timezone: Optional[str] = None
    notifications_consent: Optional[str] = None
    notifications_last_prompt: Optional[datetime] = None
    data_consent_revoked: Optional[bool] = None
    chronic_condition: Optional[str] = None
    primary_care_center: Optional[str] = None
    reminder_preferred_time: Optional[str] = None
    email_reminders_enabled: Optional[bool] = None
    notification_settings_json: Optional[str] = None


class AppPinSet(BaseModel):
    pin: str
    current_pin: Optional[str] = None


class AppPinVerify(BaseModel):
    pin: str


class AppPinStatusOut(BaseModel):
    pin_set: bool
    pin_enabled: bool


class AppPinVerifyOut(BaseModel):
    valid: bool
    pin_enabled: bool = False


class PlanInfoOut(BaseModel):
    plan_type: str
    max_profiles: int
    collaboration_enabled: bool
    family_panel_enabled: bool
    current_profiles: int
    ai_access_level: str
    ai_chat_daily_limit: Optional[int] = None


class PlanMetricOut(BaseModel):
    label: str
    value: str


class PlanDetailSectionOut(BaseModel):
    title: str
    items: list[str]


class PublicPlanOut(BaseModel):
    slug: str
    name: str
    price_monthly: str
    price_yearly: str
    yearly_equivalent: str
    note: str
    summary: str
    recommended: bool
    cta: str
    features: list[str]
    detail_sections: list[PlanDetailSectionOut]
    metrics: list[PlanMetricOut]


class HealthProfileCreate(BaseModel):
    full_name: str
    birth_date: Optional[datetime] = None
    gender: Optional[str] = ""
    relation_with_owner: Optional[str] = ""
    avatar_url: Optional[str] = ""
    base_medical_data: Optional[str] = ""


class HealthProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    birth_date: Optional[datetime] = None
    gender: Optional[str] = None
    relation_with_owner: Optional[str] = None
    avatar_url: Optional[str] = None
    base_medical_data: Optional[str] = None
    is_archived: Optional[bool] = None


class HealthProfileOut(BaseModel):
    id: int
    owner_user_id: int
    owner_name: Optional[str] = ""
    owner_email: Optional[str] = ""
    full_name: str
    birth_date: Optional[datetime] = None
    gender: Optional[str] = ""
    relation_with_owner: Optional[str] = ""
    avatar_url: Optional[str] = ""
    base_medical_data: Optional[str] = ""
    is_primary_profile: bool = False
    is_archived: bool = False
    created_by_user_id: int
    created_at: datetime
    access_role: Optional[str] = None
    access_status: Optional[str] = None
    relationship_type: Optional[str] = None

    @field_serializer('birth_date', 'created_at')
    def serialize_profile_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class ProfileRelationshipOut(BaseModel):
    id: int
    profile_id: int
    user_id: int
    user_name: Optional[str] = ""
    user_email: Optional[str] = ""
    user_avatar_url: Optional[str] = ""
    relationship_type: Optional[str] = ""
    role: str
    status: str
    invited_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    created_at: datetime

    @field_serializer('invited_at', 'accepted_at', 'created_at')
    def serialize_relation_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')


class ProfileInvitationCreate(BaseModel):
    email: EmailStr
    role: str = "viewer"
    relationship_type: Optional[str] = ""


class ProfileInvitationOut(BaseModel):
    id: int
    profile_id: int
    inviter_user_id: int
    invitee_email: EmailStr
    role: str
    relationship_type: Optional[str] = ""
    status: str
    token: str
    accepted_by_user_id: Optional[int] = None
    invited_at: datetime
    accepted_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None

    @field_serializer('invited_at', 'accepted_at', 'revoked_at')
    def serialize_invitation_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')


class PendingProfileInvitationOut(BaseModel):
    id: int
    profile_id: int
    profile_name: str
    inviter_user_id: int
    inviter_name: Optional[str] = ""
    invitee_email: EmailStr
    role: str
    relationship_type: Optional[str] = ""
    status: str
    token: str
    invited_at: datetime

    @field_serializer('invited_at')
    def serialize_pending_invitation_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')


class ProfileInvitationAcceptIn(BaseModel):
    token: str


class ProfileRoleUpdateIn(BaseModel):
    role: str
    relationship_type: Optional[str] = None


class FamilyPanelCardOut(BaseModel):
    profile_id: int
    name: str
    relationship: Optional[str] = ""
    age_years: Optional[int] = None
    medications_active: int = 0
    next_appointment_at: Optional[datetime] = None
    next_appointment_center: Optional[str] = ""
    reminders_pending: int = 0
    caregivers_count: int = 0
    access_role: Optional[str] = ""

    @field_serializer('next_appointment_at')
    def serialize_panel_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')


class ProfileAutomationSettingsOut(BaseModel):
    smart_alerts_enabled: bool = True
    medication_overdue_alerts: bool = True
    upcoming_appointment_alerts: bool = True
    inactivity_alerts: bool = True
    weekly_family_report_enabled: bool = False
    auto_email_caregivers: bool = False
    voice_auto_share_enabled: bool = False
    voice_auto_share_include_audio: bool = True
    voice_auto_share_recipient_ids: list[int] = []


class ProfileAutomationSettingsIn(BaseModel):
    smart_alerts_enabled: Optional[bool] = None
    medication_overdue_alerts: Optional[bool] = None
    upcoming_appointment_alerts: Optional[bool] = None
    inactivity_alerts: Optional[bool] = None
    weekly_family_report_enabled: Optional[bool] = None
    auto_email_caregivers: Optional[bool] = None
    voice_auto_share_enabled: Optional[bool] = None
    voice_auto_share_include_audio: Optional[bool] = None
    voice_auto_share_recipient_ids: Optional[list[int]] = None


class FamilyAlertOut(BaseModel):
    id: str
    profile_id: int
    profile_name: str
    severity: str
    category: str
    title: str
    message: str
    suggested_action: Optional[str] = ""
    generated_at: datetime

    @field_serializer('generated_at')
    def serialize_alert_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')


class FamilyReportProfileOut(BaseModel):
    profile_id: int
    profile_name: str
    medications_active: int = 0
    medications_completed: int = 0
    intakes_recorded: int = 0
    appointments_total: int = 0
    appointments_completed: int = 0
    appointments_upcoming: int = 0
    documents_uploaded: int = 0
    adherence_rate: Optional[float] = None


class FamilyReportOut(BaseModel):
    generated_at: datetime
    period_days: int
    totals: dict
    profiles: list[FamilyReportProfileOut]

    @field_serializer('generated_at')
    def serialize_report_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')


NOTE_COLORS = {"yellow", "pink", "mint", "lavender", "peach"}


class ProfileNoteCreate(BaseModel):
    note: str
    visibility: Optional[str] = "shared"
    color: Optional[str] = "yellow"
    reminder_at: Optional[datetime] = None


class ProfileNoteUpdate(BaseModel):
    note: Optional[str] = None
    visibility: Optional[str] = None
    color: Optional[str] = None
    reminder_at: Optional[datetime] = None


class ProfileNoteOut(BaseModel):
    id: int
    profile_id: int
    created_by_user_id: int
    created_by_name: Optional[str] = ""
    note: str
    visibility: str
    color: str = "yellow"
    reminder_at: Optional[datetime] = None
    reminder_sent: bool = False
    created_at: datetime
    updated_at: datetime

    @field_serializer('created_at', 'updated_at')
    def serialize_note_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    @field_serializer('reminder_at')
    def serialize_reminder_at(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        # reminder_at is stored as UTC naive; append Z so the browser
        # parses it as UTC and toLocalInputValue() converts it to local time.
        return dt.strftime('%Y-%m-%dT%H:%M:%SZ')

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    # MFA: si está pendiente de verificación, solo se devuelve mfa_token
    mfa_required: Optional[bool] = None
    mfa_token: Optional[str] = None
    # Sesiones: refresh token
    refresh_token: Optional[str] = None


class TokenData(BaseModel):
    user_id: Optional[int] = None


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str
    new_password: str


# ─── MFA ──────────────────────────────────────────────────────────────────────

class MfaEnrollOut(BaseModel):
    totp_uri: str           # otpauth:// URI para QR
    secret: str             # base32 secret (para mostrar al usuario como respaldo)
    backup_codes: List[str] # 10 códigos de un solo uso (texto plano, solo en este momento)


class MfaVerifyIn(BaseModel):
    code: str               # código TOTP de 6 dígitos, o backup code


class MfaLoginIn(BaseModel):
    mfa_token: str          # token temporal devuelto por login cuando MFA está activo
    code: str               # código TOTP o backup code


class MfaDisableIn(BaseModel):
    code: str               # TOTP o backup code para confirmar desactivación


# ─── Sesiones / Refresh Tokens ────────────────────────────────────────────────

class RefreshTokenIn(BaseModel):
    refresh_token: str


class SessionOut(BaseModel):
    id: int
    device_label: str
    ip_address: str
    created_at: datetime
    last_used_at: Optional[datetime] = None
    is_current: bool = False

    class Config:
        from_attributes = True


# ─── Permisos granulares ──────────────────────────────────────────────────────

class PermissionsUpdate(BaseModel):
    permissions: List[str]  # lista de strings como "view_documents", "download_documents"…


# ─── Step-up authentication ────────────────────────────────────────────────────

class StepUpVerifyIn(BaseModel):
    proof: str   # código TOTP de 6 dígitos, backup code o contraseña actual


class StepUpOut(BaseModel):
    stepup_token: str
    expires_in: int = 600  # segundos


class AppointmentBase(BaseModel):
    type: AppointmentType
    profile_id: Optional[int] = None
    episode_id: Optional[int] = None
    specialty: Optional[str] = ""
    center: Optional[str] = ""
    date_time: Optional[datetime] = None
    status: Optional[AppointmentStatus] = AppointmentStatus.pendiente
    notes: Optional[str] = ""
    checklist: Optional[list] = []


class AppointmentCreate(AppointmentBase):
    pass


class AppointmentUpdate(AppointmentBase):
    pass


class AppointmentOut(AppointmentBase):
    id: int
    user_id: Optional[int]
    created_at: datetime

    @field_serializer('date_time', 'created_at')
    def serialize_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        # Serializar en formato ISO sin conversión a UTC
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class DocumentBase(BaseModel):
    doc_type: DocumentType
    episode_id: Optional[int] = None
    appointment_id: Optional[int] = None
    date: Optional[datetime] = None
    center: Optional[str] = ""
    notes: Optional[str] = ""


class DocumentOut(DocumentBase):
    id: int
    profile_id: Optional[int] = None
    file_path: str
    filename: Optional[str] = None
    ocr_status: Optional[str] = None
    ocr_lang: Optional[str] = None
    created_at: datetime

    @field_serializer('date', 'created_at')
    def serialize_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        # Serializar en formato ISO sin conversión a UTC
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class DocumentUpdate(BaseModel):
    doc_type: Optional[DocumentType] = None
    episode_id: Optional[int] = None
    appointment_id: Optional[int] = None
    date: Optional[datetime] = None
    center: Optional[str] = None
    notes: Optional[str] = None
    filename: Optional[str] = None


class MedicationBase(BaseModel):
    profile_id: Optional[int] = None
    episode_id: Optional[int] = None
    name: str
    dose: Optional[str] = ""
    frequency: Optional[str] = ""
    duration: Optional[str] = ""
    schedule_time: Optional[str] = ""
    start_at: Optional[datetime] = None
    refill_enabled: Optional[bool] = False
    refill_mode: Optional[str] = "rotativo"
    refill_fixed_user_id: Optional[int] = None
    refill_participant_user_ids: Optional[List[int]] = None
    doses_per_intake: Optional[float] = 1.0
    frequency_per_day: Optional[float] = 1.0
    stock_total_doses: Optional[int] = 0
    refill_alert_threshold_doses: Optional[int] = 0
    completed: Optional[bool] = False
    end_date: Optional[datetime] = None
    notes: Optional[str] = ""
    document_id: Optional[int] = None


class MedicationCreate(MedicationBase):
    pass


class MedicationUpdate(BaseModel):
    name: Optional[str] = None
    dose: Optional[str] = None
    frequency: Optional[str] = None
    duration: Optional[str] = None
    schedule_time: Optional[str] = None
    start_at: Optional[datetime] = None
    refill_enabled: Optional[bool] = None
    refill_mode: Optional[str] = None
    refill_fixed_user_id: Optional[int] = None
    refill_participant_user_ids: Optional[List[int]] = None
    doses_per_intake: Optional[float] = None
    frequency_per_day: Optional[float] = None
    stock_total_doses: Optional[int] = None
    refill_alert_threshold_doses: Optional[int] = None
    completed: Optional[bool] = None
    end_date: Optional[datetime] = None
    notes: Optional[str] = None
    document_id: Optional[int] = None


class MedicationOut(MedicationBase):
    id: int
    user_id: int
    created_at: datetime
    schedule_anchor_at: Optional[datetime] = None
    expected_doses: int = 0
    total_planned_doses: Optional[int] = None
    taken_doses: int = 0
    missed_doses: int = 0
    adherence_rate: Optional[float] = None
    next_dose_at: Optional[datetime] = None
    effective_end_date: Optional[datetime] = None
    computed_schedule_times: List[str] = []
    computed_schedule_summary: str = ""
    effective_frequency_per_day: Optional[float] = None
    remaining_doses: Optional[int] = None
    days_remaining: Optional[float] = None
    refill_status: Optional[str] = "normal"  # normal | alert | critical
    refill_current_assignee_user_id: Optional[int] = None
    refill_current_assignee_name: Optional[str] = ""
    refill_next_assignee_name: Optional[str] = ""
    refill_participant_names: List[str] = []
    refill_contacts_count: int = 0
    refill_alert_active: bool = False

    @field_serializer('start_at', 'end_date', 'created_at', 'schedule_anchor_at', 'effective_end_date', 'next_dose_at')
    def serialize_datetime(self, dt: Optional[datetime], _info):
        return _serialize_datetime_preserving_offset(dt)

    class Config:
        from_attributes = True


class MedicationPurchaseOut(BaseModel):
    id: int
    user_id: int
    medication_id: int
    profile_id: Optional[int] = None
    episode_id: Optional[int] = None
    assigned_user_id: Optional[int] = None
    purchased_by_user_id: Optional[int] = None
    medication_name_snapshot: str = ""
    dose_snapshot: str = ""
    assigned_name_snapshot: str = ""
    purchased_by_name_snapshot: str = ""
    quantity_added_doses: int = 0
    previous_remaining_doses: Optional[int] = None
    new_stock_total_doses: int = 0
    amount_total: Optional[float] = None
    currency: str = "CLP"
    notes: Optional[str] = ""
    receipt_filename: Optional[str] = None
    has_receipt: bool = False
    purchased_at: Optional[datetime] = None
    created_at: datetime

    @field_serializer('purchased_at', 'created_at')
    def serialize_purchase_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class MedicationIntakeOut(BaseModel):
    id: int
    medication_id: int
    user_id: int
    scheduled_at: Optional[datetime] = None
    taken_at: Optional[datetime] = None
    status: str = "taken"
    source: str = "manual"
    notes: str = ""
    created_at: Optional[datetime] = None

    @field_serializer('scheduled_at', 'taken_at', 'created_at')
    def serialize_intake_datetime(self, dt: Optional[datetime], _info):
        return _serialize_datetime_preserving_offset(dt)

    class Config:
        from_attributes = True


class MedicationIntakeCreate(BaseModel):
    scheduled_at: Optional[datetime] = None
    taken_at: Optional[datetime] = None
    status: str = "taken"
    source: str = "manual"
    notes: Optional[str] = ""


class MedicationIntakeListOut(BaseModel):
    medication_id: int
    items: list[MedicationIntakeOut] = []
    total_events: int = 0
    taken_events: int = 0
    missed_events: int = 0
    skipped_events: int = 0


class MedicationIntakeBackfillOut(BaseModel):
    medication_id: int
    created: int = 0


class BiometricReadingBase(BaseModel):
    profile_id: Optional[int] = None
    metric_type: str
    value_primary: float
    value_secondary: Optional[float] = None
    unit: Optional[str] = ""
    context: Optional[str] = ""
    notes: Optional[str] = ""
    measured_at: Optional[datetime] = None


class BiometricReadingCreate(BiometricReadingBase):
    pass


class BiometricReadingOut(BiometricReadingBase):
    id: int
    user_id: int
    recorded_by_user_id: Optional[int] = None
    created_at: Optional[datetime] = None

    @field_serializer("measured_at", "created_at")
    def serialize_biometric_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")

    class Config:
        from_attributes = True


class BiometricMetricSummaryOut(BaseModel):
    metric_type: str
    label: str
    unit: str = ""
    description: str = ""
    readings_count: int = 0
    latest_reading: Optional[BiometricReadingOut] = None
    average_primary: Optional[float] = None
    trend_direction: str = "stable"
    trend_summary: str = ""
    chart_points: list[BiometricReadingOut] = []


class BiometricDashboardOut(BaseModel):
    profile_id: int
    monitoring_active: bool = False
    active_metrics_count: int = 0
    latest_recorded_at: Optional[datetime] = None
    metrics: list[BiometricMetricSummaryOut] = []
    recent_readings: list[BiometricReadingOut] = []
    insights: list[str] = []

    @field_serializer("latest_recorded_at")
    def serialize_biometric_dashboard_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")


class ClinicalTaskBase(BaseModel):
    task_type: str = "follow_up"
    title: str
    description: str = ""
    status: str = "pending"
    due_at: datetime | None = None
    completed_at: datetime | None = None
    source_module: str = ""
    source_record_type: str = ""
    source_record_id: int | None = None
    metadata_json: dict | None = None


class ClinicalTaskOut(ClinicalTaskBase):
    id: int
    episode_id: int
    profile_id: int
    owner_user_id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_serializer('due_at', 'completed_at', 'created_at', 'updated_at')
    def serialize_clinical_task_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class ClinicalEpisodeBase(BaseModel):
    title: str
    episode_type: str = "general"
    status: ClinicalEpisodeStatus = ClinicalEpisodeStatus.active
    source: str = "manual"
    started_at: datetime | None = None
    last_activity_at: datetime | None = None
    closed_at: datetime | None = None
    summary: str = ""
    care_summary: str = ""
    tags_json: list[str] = []
    metadata_json: dict | None = None


class ClinicalEpisodeOut(ClinicalEpisodeBase):
    id: int
    profile_id: int
    owner_user_id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None
    linked_appointments: int = 0
    linked_documents: int = 0
    linked_medications: int = 0
    linked_external_records: int = 0
    pending_tasks: int = 0
    next_due_at: datetime | None = None

    @field_serializer(
        'started_at',
        'last_activity_at',
        'closed_at',
        'created_at',
        'updated_at',
        'next_due_at',
    )
    def serialize_clinical_episode_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class EpisodeTimelineEventOut(BaseModel):
    event_type: str
    title: str
    summary: str = ""
    event_at: datetime | None = None
    source_module: str = ""
    source_record_type: str = ""
    source_record_id: int | None = None
    metadata_json: dict = {}

    @field_serializer('event_at')
    def serialize_episode_timeline_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')


class ClinicalFolderItemOut(BaseModel):
    item_type: str
    item_id: int
    title: str
    subtitle: str = ""
    event_at: datetime | None = None
    status_label: str = ""
    source_module: str = ""
    metadata_json: dict = {}

    @field_serializer('event_at')
    def serialize_folder_item_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')


class EpisodeRelatedItemsOut(BaseModel):
    appointments: list[AppointmentOut] = []
    documents: list[DocumentOut] = []
    medications: list[MedicationOut] = []
    external_records: list["ExternalClinicalRecordOut"] = []


class ClinicalEpisodeDetailOut(BaseModel):
    episode: ClinicalEpisodeOut
    tasks: list[ClinicalTaskOut] = []
    folder_items: list[ClinicalFolderItemOut] = []
    timeline: list[EpisodeTimelineEventOut] = []
    related_items: EpisodeRelatedItemsOut
    ai_context: dict = {}


class HealthProblemCreate(BaseModel):
    name: str
    detail: str = ""
    status: str = "active"
    severity: str = ""
    source_type: str = "manual"
    source_id: int | None = None
    onset_at: datetime | None = None
    resolved_at: datetime | None = None
    metadata_json: dict | None = None


class HealthProblemUpdate(BaseModel):
    name: str | None = None
    detail: str | None = None
    status: str | None = None
    severity: str | None = None
    source_type: str | None = None
    source_id: int | None = None
    onset_at: datetime | None = None
    resolved_at: datetime | None = None
    metadata_json: dict | None = None


class HealthProblemOut(BaseModel):
    id: int
    profile_id: int
    owner_user_id: int
    name: str
    detail: str = ""
    status: str = "active"
    severity: str = ""
    source_type: str = "manual"
    source_id: int | None = None
    onset_at: datetime | None = None
    resolved_at: datetime | None = None
    metadata_json: dict | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_serializer("onset_at", "resolved_at", "created_at", "updated_at")
    def serialize_health_problem_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")

    class Config:
        from_attributes = True


class HealthVaccineRecordCreate(BaseModel):
    vaccine_name: str
    dose_label: str = ""
    status: str = "documented"
    administered_at: datetime | None = None
    next_due_at: datetime | None = None
    provider_name: str = ""
    lot_number: str = ""
    source_type: str = "manual"
    source_id: int | None = None
    notes: str = ""
    metadata_json: dict | None = None


class HealthVaccineRecordUpdate(BaseModel):
    vaccine_name: str | None = None
    dose_label: str | None = None
    status: str | None = None
    administered_at: datetime | None = None
    next_due_at: datetime | None = None
    provider_name: str | None = None
    lot_number: str | None = None
    source_type: str | None = None
    source_id: int | None = None
    notes: str | None = None
    metadata_json: dict | None = None


class HealthVaccineRecordOut(BaseModel):
    id: int
    profile_id: int
    owner_user_id: int
    vaccine_name: str
    dose_label: str = ""
    status: str = "documented"
    administered_at: datetime | None = None
    next_due_at: datetime | None = None
    provider_name: str = ""
    lot_number: str = ""
    source_type: str = "manual"
    source_id: int | None = None
    notes: str = ""
    metadata_json: dict | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_serializer("administered_at", "next_due_at", "created_at", "updated_at")
    def serialize_health_vaccine_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")

    class Config:
        from_attributes = True


class HealthExamResultCreate(BaseModel):
    exam_name: str
    category: str = ""
    status: str = "documented"
    summary: str = ""
    values_json: list[dict] = []
    performed_at: datetime | None = None
    source_type: str = "manual"
    source_id: int | None = None
    metadata_json: dict | None = None


class HealthExamResultUpdate(BaseModel):
    exam_name: str | None = None
    category: str | None = None
    status: str | None = None
    summary: str | None = None
    values_json: list[dict] | None = None
    performed_at: datetime | None = None
    source_type: str | None = None
    source_id: int | None = None
    metadata_json: dict | None = None


class HealthExamResultOut(BaseModel):
    id: int
    profile_id: int
    owner_user_id: int
    exam_name: str
    category: str = ""
    status: str = "documented"
    summary: str = ""
    values_json: list[dict] = []
    performed_at: datetime | None = None
    source_type: str = "manual"
    source_id: int | None = None
    metadata_json: dict | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_serializer("performed_at", "created_at", "updated_at")
    def serialize_health_exam_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")

    class Config:
        from_attributes = True


class HealthSheetActionCreate(BaseModel):
    title: str
    description: str = ""
    task_type: str = "follow_up"
    due_at: datetime | None = None
    episode_id: int | None = None
    source_type: str = "health_sheet"
    source_id: int | None = None
    metadata_json: dict | None = None


class ContinuityActionOut(BaseModel):
    id: str
    title: str
    description: str = ""
    status: str = "pending"
    priority: str = "normal"
    due_at: datetime | None = None
    episode_id: int | None = None
    source_type: str = ""
    source_id: int | None = None
    action_label: str = ""

    @field_serializer("due_at")
    def serialize_continuity_action_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")


class ContinuityPreparationOut(BaseModel):
    appointment_id: int | None = None
    appointment_type: str = ""
    specialty: str = ""
    center: str = ""
    date_time: datetime | None = None
    documents_to_bring: list[str] = []
    active_medications_count: int = 0
    suggested_questions: list[str] = []

    @field_serializer("date_time")
    def serialize_continuity_preparation_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")


class ContinuityPanelOut(BaseModel):
    profile_id: int
    generated_at: datetime
    summary: str = ""
    next_step: ContinuityActionOut | None = None
    overdue: list[ContinuityActionOut] = []
    requires_action: list[ContinuityActionOut] = []
    upcoming_preparation: ContinuityPreparationOut | None = None
    counts: dict = {}

    @field_serializer("generated_at")
    def serialize_continuity_panel_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")


class HealthSheetSourceOut(BaseModel):
    source_type: str = ""
    source_id: int | None = None
    label: str = ""
    date: datetime | None = None

    @field_serializer("date")
    def serialize_health_sheet_source_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")


class HealthSheetDiagnosisOut(BaseModel):
    name: str
    detail: str = ""
    status: str = "documented"
    confidence: int = 0
    source: HealthSheetSourceOut | None = None


class HealthSheetVaccineOut(BaseModel):
    name: str
    status: str = "documented"
    date: datetime | None = None
    source: HealthSheetSourceOut | None = None

    @field_serializer("date")
    def serialize_health_sheet_vaccine_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")


class HealthSheetExamOut(BaseModel):
    name: str
    summary: str = ""
    date: datetime | None = None
    abnormal_values: list[dict] = []
    source: HealthSheetSourceOut | None = None

    @field_serializer("date")
    def serialize_health_sheet_exam_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")


class HealthSheetIndicationOut(BaseModel):
    title: str
    detail: str = ""
    indication_type: str = "otro"
    status: str = "active"
    source: HealthSheetSourceOut | None = None


class HealthSheetOut(BaseModel):
    profile_id: int
    profile_name: str = ""
    generated_at: datetime
    summary: str = ""
    diagnoses: list[HealthSheetDiagnosisOut] = []
    vaccines: list[HealthSheetVaccineOut] = []
    exams: list[HealthSheetExamOut] = []
    indications: list[HealthSheetIndicationOut] = []
    counts: dict = {}
    sources: list[HealthSheetSourceOut] = []

    @field_serializer("generated_at")
    def serialize_health_sheet_generated_at(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")


class EpisodeLinkRequest(BaseModel):
    item_type: str
    item_id: int
    episode_id: int | None = None


class EpisodeLinkResultOut(BaseModel):
    item_type: str
    item_id: int
    previous_episode_id: int | None = None
    episode_id: int | None = None
    episode_title: str | None = None


class AdherenceSummaryOut(BaseModel):
    id: int
    profile_id: int
    medication_id: Optional[int] = None
    window_days: int = 30
    adherence_rate: int = 0
    missed_count: int = 0
    late_count: int = 0
    expected_doses: int = 0
    taken_doses: int = 0
    pattern_json: dict | None = None
    updated_at: datetime | None = None

    @field_serializer('updated_at')
    def serialize_adherence_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class HealthAlertOut(BaseModel):
    id: int
    profile_id: int
    alert_type: str
    severity: str
    title: str
    description: str
    evidence_json: dict | None = None
    recommended_action: str = ""
    status: str = "active"
    detected_at: datetime | None = None
    updated_at: datetime | None = None

    @field_serializer('detected_at', 'updated_at')
    def serialize_health_alert_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class DocumentClinicalEntityOut(BaseModel):
    id: int
    document_id: int
    entity_type: str
    entity_name: str = ""
    entity_value: str = ""
    unit: str = ""
    reference_range: str = ""
    flag: str = "unknown"
    confidence: int = 0
    source_text: str = ""
    created_at: datetime | None = None

    @field_serializer('created_at')
    def serialize_document_entity_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class DocumentSummaryOut(BaseModel):
    id: int
    document_id: int
    document_type_inferred: str = "otro"
    summary_plain: str = ""
    patient_friendly_explanation: str = ""
    key_points_json: list | None = None
    abnormal_values_json: list | None = None
    requires_review: bool = False
    updated_at: datetime | None = None

    @field_serializer('updated_at')
    def serialize_document_summary_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class DocumentAnalysisOut(BaseModel):
    """Análisis completo de un documento para el asistente de subida (wizard):
    tipo detectado + resumen amigable + entidades clínicas limpias."""
    document_id: int
    doc_type: str = "otro"
    ocr_status: Optional[str] = None
    is_historical: bool = False
    summary: Optional[DocumentSummaryOut] = None
    entities: list[DocumentClinicalEntityOut] = []

    class Config:
        from_attributes = True


class CoveragePreferenceUpdate(BaseModel):
    enabled: Optional[bool] = None
    payer_type: Optional[str] = None
    provider_name: Optional[str] = None
    plan_name: Optional[str] = None
    notes: Optional[str] = None


class CoveragePreferenceOut(BaseModel):
    id: Optional[int] = None
    profile_id: int
    owner_user_id: int
    enabled: bool = False
    payer_type: str = "unknown"
    provider_name: str = ""
    plan_name: str = ""
    notes: str = ""
    configured_by_user_id: Optional[int] = None
    updated_at: Optional[datetime] = None

    @field_serializer('updated_at')
    def serialize_coverage_preference_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class CoverageDocumentInfoOut(BaseModel):
    category: str = "otro"
    payer_type: str = "unknown"
    provider_name: str = ""
    entity_name: str = ""
    amount_total: Optional[float] = None
    amount_covered: Optional[float] = None
    amount_patient: Optional[float] = None
    amount_reimbursed: Optional[float] = None
    currency: str = "CLP"
    status: str = ""
    metadata_json: dict | None = None
    updated_at: Optional[datetime] = None

    @field_serializer('updated_at')
    def serialize_coverage_info_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class CoverageDocumentOut(BaseModel):
    document: DocumentOut
    coverage: CoverageDocumentInfoOut


class CoverageDocumentInfoUpdate(BaseModel):
    category: Optional[str] = None
    payer_type: Optional[str] = None
    provider_name: Optional[str] = None
    entity_name: Optional[str] = None
    amount_total: Optional[float] = None
    amount_covered: Optional[float] = None
    amount_patient: Optional[float] = None
    amount_reimbursed: Optional[float] = None
    currency: Optional[str] = None
    status: Optional[str] = None
    metadata_json: Optional[dict] = None


class ProfileHealthFeatureOut(BaseModel):
    profile_id: int
    next_appointment_at: datetime | None = None
    last_appointment_at: datetime | None = None
    active_medications_count: int = 0
    low_adherence_risk: bool = False
    treatment_completion_score: int = 0
    missing_documents_flags_json: dict | None = None
    extra_features_json: dict | None = None
    updated_at: datetime | None = None

    @field_serializer('next_appointment_at', 'last_appointment_at', 'updated_at')
    def serialize_profile_feature_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class ClinicalReportRequest(BaseModel):
    report_type: str = "consulta_medica"
    period_days: int = 30


class ClinicalReportOut(BaseModel):
    id: int
    profile_id: int
    report_type: str
    period_start: datetime | None = None
    period_end: datetime | None = None
    report_json: dict | None = None
    pdf_filename: str = ""
    created_at: datetime | None = None

    @field_serializer('period_start', 'period_end', 'created_at')
    def serialize_clinical_report_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class AiHealthContextOut(BaseModel):
    profile: dict
    plan: dict
    adherence_summary: dict
    health_alerts: list[HealthAlertOut] = []
    document_summaries: list[DocumentSummaryOut] = []
    profile_health_features: dict = {}
    context: dict = {}


class AiFamilyProfileInsightOut(BaseModel):
    profile_id: int
    profile_name: str
    relation_with_owner: str = ""
    active_alerts: int = 0
    upcoming_appointments: int = 0
    low_adherence: bool = False
    relevant_conditions: list[str] = []
    relevant_medications: list[str] = []
    relevant_appointments: list[str] = []
    pending_documents: list[str] = []
    key_alerts: list[str] = []
    key_risks: list[str] = []


class AiFamilyContextOut(BaseModel):
    generated_at: datetime | None = None
    family_size: int = 0
    active_alerts_total: int = 0
    pending_documents_total: int = 0
    low_adherence_profiles: int = 0
    summary: str = ""
    profiles: list[AiFamilyProfileInsightOut] = []

    @field_serializer('generated_at')
    def serialize_family_context_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')


class LifeTimelineEventOut(BaseModel):
    id: str
    profile_id: int
    profile_name: str = ""
    event_type: str
    category: str
    title: str
    summary: str = ""
    event_at: datetime | None = None
    related_ids: dict = {}
    metadata_json: dict = {}

    @field_serializer('event_at')
    def serialize_life_timeline_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')


class LifeTimelineOut(BaseModel):
    generated_at: datetime | None = None
    profile_id: int | None = None
    include_family: bool = False
    summary: str = ""
    event_count: int = 0
    events: list[LifeTimelineEventOut] = []

    @field_serializer('generated_at')
    def serialize_life_timeline_generated_at(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')


class ExternalClinicalSourceCreate(BaseModel):
    source_type: str = "manual"
    source_name: str
    status: str = "connected"
    metadata_json: dict | None = None


class ExternalClinicalSourceOut(BaseModel):
    id: int
    profile_id: int
    source_type: str
    source_name: str
    status: str
    last_sync_at: datetime | None = None
    metadata_json: dict | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_serializer('last_sync_at', 'created_at', 'updated_at')
    def serialize_external_source_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class ExternalClinicalRecordCreate(BaseModel):
    source_id: int | None = None
    episode_id: int | None = None
    external_id: str = ""
    record_type: str = "lab_result"
    title: str
    summary: str = ""
    payload_json: dict | None = None
    event_at: datetime | None = None


class ExternalClinicalRecordOut(BaseModel):
    id: int
    profile_id: int
    source_id: int | None = None
    episode_id: int | None = None
    external_id: str = ""
    record_type: str
    title: str
    summary: str = ""
    payload_json: dict | None = None
    event_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_serializer('event_at', 'created_at', 'updated_at')
    def serialize_external_record_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: dict | None = None


class PushSubscriptionOut(BaseModel):
    id: int
    endpoint: str
    created_at: datetime

    @field_serializer('created_at')
    def serialize_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        # Serializar en formato ISO sin conversión a UTC
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class PrivacyRequestIn(BaseModel):
    reason: str
    message: str
    include_tech: Optional[bool] = False


# ─── KlinipFeed ───────────────────────────────────────────────────────────────

class FeedPostCreate(BaseModel):
    content: str = ""
    post_type: str = "general"  # general | exam_result | doctor_visit | medication
    privacy: str = "family"
    profile_id: int
    linked_document_id: Optional[int] = None
    mention_profile_ids: list[int] = []


class FeedPostUpdate(BaseModel):
    content: str = ""
    post_type: str = "general"
    privacy: str = "family"
    profile_id: int
    linked_document_id: Optional[int] = None
    mention_profile_ids: list[int] = []


class PostCommentCreate(BaseModel):
    content: str
    parent_comment_id: Optional[int] = None
    mention_user_ids: list[int] = []


class PostReactionCreate(BaseModel):
    reaction_type: str = "like"  # like | heart | care


class PostCommentOut(BaseModel):
    id: int
    post_id: int
    user_id: int
    user_name: Optional[str] = ""
    user_avatar_url: Optional[str] = ""
    parent_comment_id: Optional[int] = None
    mention_user_ids: list[int] = []
    likes_count: int = 0
    my_like: bool = False
    content: str
    created_at: datetime

    @field_serializer("created_at")
    def serialize_comment_dt(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")

    class Config:
        from_attributes = True


class PostReactionOut(BaseModel):
    id: int
    post_id: int
    user_id: int
    user_name: Optional[str] = ""
    reaction_type: str
    created_at: datetime

    @field_serializer("created_at")
    def serialize_reaction_dt(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")

    class Config:
        from_attributes = True


class PostAttachmentOut(BaseModel):
    id: int
    post_id: int
    attachment_type: str
    filename: str = ""
    created_at: datetime

    @field_serializer("created_at")
    def serialize_attachment_dt(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")

    class Config:
        from_attributes = True


class FeedPostOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = ""
    profile_id: int
    profile_name: Optional[str] = ""
    content: str = ""
    post_type: str = "general"
    privacy: str = "family"
    linked_document_id: Optional[int] = None
    mention_profile_ids: list[int] = []
    reactions_count: int = 0
    my_reaction: Optional[str] = None
    comments_count: int = 0
    attachments: list[PostAttachmentOut] = []
    comments: list[PostCommentOut] = []
    created_at: datetime
    updated_at: Optional[datetime] = None

    @field_serializer("created_at", "updated_at")
    def serialize_feed_post_dt(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%S")

    class Config:
        from_attributes = True


class AiChatMessageIn(BaseModel):
    role: str
    content: str


class AiChatAttachmentIn(BaseModel):
    filename: str
    content_type: Optional[str] = None
    data_base64: str
    size_bytes: Optional[int] = 0


class AiChatRequest(BaseModel):
    message: str
    history: list[AiChatMessageIn] = []
    conversation_id: str | None = None
    attachment: AiChatAttachmentIn | None = None


class AiChatTranscriptionOut(BaseModel):
    transcript: str
    model: str = ""
    language: str = "es"


class AiContextSourceOut(BaseModel):
    key: str
    label: str
    count: int = 0
    enabled: bool = True


class AiReferenceOut(BaseModel):
    kind: str
    label: str
    detail: str = ""


class AiChatResponse(BaseModel):
    reply: str
    disclaimer: str
    model: str
    mode: str
    active_profile_id: int | None = None
    active_profile_name: str = ""
    sources: list[AiContextSourceOut] = []
    references: list[AiReferenceOut] = []
    user_message_created_at: str = ""
    assistant_message_created_at: str = ""
    conversation_id: str = ""
    conversation_title: str = ""


class AiConversationRenameIn(BaseModel):
    title: str


class AiConversationSummaryOut(BaseModel):
    conversation_id: str
    title: str
    updated_at: datetime | None = None
    message_count: int = 0
    last_message_excerpt: str = ""

    @field_serializer('updated_at')
    def serialize_ai_conversation_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')


class AiConversationMessageOut(BaseModel):
    id: int
    profile_id: int
    user_id: int
    conversation_id: str = ""
    conversation_title: str = ""
    role: str
    content: str
    metadata_json: dict | None = None
    created_at: datetime

    @field_serializer('created_at')
    def serialize_ai_message_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


# ── Klinip Voice ───────────────────────────────────────────────────────────

class VoiceShareTargetOut(BaseModel):
    user_id: int
    user_name: Optional[str] = ""
    user_email: Optional[str] = ""
    relationship_type: Optional[str] = ""
    role: str = "viewer"
    is_auto_selected: bool = False


class VoiceFamilyShareIn(BaseModel):
    recipient_user_ids: list[int]
    include_audio: bool = True


class VoiceFamilyShareOut(BaseModel):
    id: int
    recipient_user_id: int
    recipient_name: Optional[str] = ""
    recipient_email: Optional[str] = ""
    relationship_type: Optional[str] = ""
    role: str = "viewer"
    share_mode: str = "manual"
    include_audio: bool = True
    status: str = "active"
    shared_at: datetime
    revoked_at: Optional[datetime] = None

    @field_serializer('shared_at', 'revoked_at')
    def serialize_voice_share_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')


class VoiceShareConfirmationOut(BaseModel):
    saved_in_profile: bool = True
    share_mode: str = "manual"
    include_audio: bool = True
    recipient_count: int = 0
    recipient_names: list[str] = []
    notified_recipient_count: int = 0


class VoiceSessionOut(BaseModel):
    id: int
    profile_id: int
    created_at: datetime
    audio_session_hash: str = ""
    consent_audio_available: bool = False
    transcripcion_tecnica: Optional[str] = None
    version_simple: Optional[str] = None
    indicaciones: list = []
    hablantes: Optional[dict] = None
    metadata_clinica: Optional[dict] = None
    compartido_en: Optional[datetime] = None
    link_seguro: Optional[str] = None
    link_expira_en: Optional[datetime] = None
    access_scope: str = "owner"
    shared_at: Optional[datetime] = None
    shared_by_name: Optional[str] = None
    received_share_id: Optional[int] = None
    can_view_technical: bool = True
    can_manage_family_shares: bool = False
    audio_available: bool = True
    family_share_active_count: int = 0
    family_shares: list[VoiceFamilyShareOut] = []
    share_confirmation: Optional[VoiceShareConfirmationOut] = None

    @field_serializer('created_at', 'compartido_en', 'link_expira_en', 'shared_at')
    def serialize_voice_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


EpisodeRelatedItemsOut.model_rebuild()
ClinicalEpisodeDetailOut.model_rebuild()
