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
