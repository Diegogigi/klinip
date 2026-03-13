from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, field_serializer
from .models import AppointmentType, AppointmentStatus, DocumentType


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


class PlanInfoOut(BaseModel):
    plan_type: str
    max_profiles: int
    collaboration_enabled: bool
    family_panel_enabled: bool
    current_profiles: int


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


class ProfileAutomationSettingsIn(BaseModel):
    smart_alerts_enabled: Optional[bool] = None
    medication_overdue_alerts: Optional[bool] = None
    upcoming_appointment_alerts: Optional[bool] = None
    inactivity_alerts: Optional[bool] = None
    weekly_family_report_enabled: Optional[bool] = None
    auto_email_caregivers: Optional[bool] = None


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


class ProfileNoteCreate(BaseModel):
    note: str
    visibility: Optional[str] = "shared"


class ProfileNoteOut(BaseModel):
    id: int
    profile_id: int
    created_by_user_id: int
    created_by_name: Optional[str] = ""
    note: str
    visibility: str
    created_at: datetime
    updated_at: datetime

    @field_serializer('created_at', 'updated_at')
    def serialize_note_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    user_id: Optional[int] = None


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str
    new_password: str


class AppointmentBase(BaseModel):
    type: AppointmentType
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
    appointment_id: Optional[int] = None
    date: Optional[datetime] = None
    center: Optional[str] = ""
    notes: Optional[str] = ""


class DocumentOut(DocumentBase):
    id: int
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
    appointment_id: Optional[int] = None
    date: Optional[datetime] = None
    center: Optional[str] = None
    notes: Optional[str] = None


class MedicationBase(BaseModel):
    name: str
    dose: Optional[str] = ""
    frequency: Optional[str] = ""
    duration: Optional[str] = ""
    schedule_time: Optional[str] = ""
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
    completed: Optional[bool] = None
    end_date: Optional[datetime] = None
    notes: Optional[str] = None
    document_id: Optional[int] = None


class MedicationOut(MedicationBase):
    id: int
    user_id: int
    created_at: datetime
    expected_doses: int = 0
    taken_doses: int = 0
    missed_doses: int = 0
    adherence_rate: Optional[float] = None

    @field_serializer('end_date', 'created_at')
    def serialize_datetime(self, dt: Optional[datetime], _info):
        if dt is None:
            return None
        # Serializar en formato ISO sin conversión a UTC
        return dt.strftime('%Y-%m-%dT%H:%M:%S')

    class Config:
        from_attributes = True


class MedicationIntakeOut(BaseModel):
    id: int
    medication_id: int
    user_id: int
    taken_at: datetime

    @field_serializer('taken_at')
    def serialize_datetime(self, dt: Optional[datetime], _info):
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


class AiChatMessageIn(BaseModel):
    role: str
    content: str


class AiChatRequest(BaseModel):
    message: str
    history: list[AiChatMessageIn] = []
    conversation_id: str | None = None


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
