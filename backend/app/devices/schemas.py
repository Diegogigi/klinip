from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class DevicePairingCreate(BaseModel):
    health_profile_id: int = Field(gt=0)
    label: str | None = Field(default=None, max_length=120)
    requested_scopes: list[str] = Field(min_length=1, max_length=6)
    protocol_version: int = Field(default=1, ge=1, le=999)
    expires_in_seconds: int = Field(default=300, ge=60, le=900)

    @field_validator("label")
    @classmethod
    def clean_label(cls, value: str | None) -> str | None:
        cleaned = " ".join((value or "").split()).strip()
        return cleaned or None


class PairingProfileOut(BaseModel):
    id: int
    display_name: str


class DevicePairingCreatedOut(BaseModel):
    pairing_id: str
    pairing_code: str
    expires_at: datetime
    health_profile: PairingProfileOut
    scopes: list[str]
    protocol_version: int


class DevicePairingOut(BaseModel):
    pairing_id: str
    status: str
    expires_at: datetime
    created_at: datetime
    claimed_at: datetime | None
    cancelled_at: datetime | None
    health_profile: PairingProfileOut
    scopes: list[str]
    protocol_version: int


class DeviceClaimIn(BaseModel):
    pairing_code: str = Field(min_length=8, max_length=16)
    device_label: str = Field(min_length=1, max_length=120)
    platform: str = Field(min_length=1, max_length=40)
    device_type: str = Field(min_length=1, max_length=40)
    protocol_version: int = Field(default=1, ge=1, le=999)
    capabilities: list[str] = Field(default_factory=list, max_length=12)
    app_version: str | None = Field(default=None, max_length=40)

    @field_validator("device_label", "platform", "device_type", "app_version")
    @classmethod
    def clean_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split()).strip()


class DeviceTokenOut(BaseModel):
    device_id: str
    access_token: str
    token_type: str = "bearer"
    access_expires_at: datetime
    refresh_token: str
    refresh_expires_at: datetime
    granted_profile_id: int
    scopes: list[str]
    protocol_version: int
    server_time: datetime


class DeviceRefreshIn(BaseModel):
    refresh_token: str = Field(min_length=32, max_length=256)


class DeviceRefreshOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    access_expires_at: datetime
    refresh_token: str
    refresh_expires_at: datetime
    rotated: bool = True
    server_time: datetime


class DeviceOut(BaseModel):
    device_id: str
    label: str
    platform: str
    device_type: str
    protocol_version: int
    app_version: str | None
    status: str
    profile_id: int
    profile_display_name: str
    scopes: list[str]
    capabilities: list[str]
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime | None
    revoked_at: datetime | None


class DeviceUpdateIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)

    @field_validator("label")
    @classmethod
    def clean_label(cls, value: str) -> str:
        cleaned = " ".join(value.split()).strip()
        if not cleaned:
            raise ValueError("device label is required")
        return cleaned


class DeviceRevokeOut(BaseModel):
    device_id: str
    status: str
    revoked: bool


class DeviceConfigOut(BaseModel):
    device_id: str
    label: str
    status: str
    profile_id: int
    profile_display_name: str
    scopes: list[str]
    protocol_version: int
    server_time: datetime
    revoked: bool = False


class DeviceHeartbeatIn(BaseModel):
    app_version: str | None = Field(default=None, max_length=40)
    protocol_version: int = Field(default=1, ge=1, le=999)
    capabilities: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("app_version")
    @classmethod
    def clean_app_version(cls, value: str | None) -> str | None:
        cleaned = " ".join((value or "").split()).strip()
        return cleaned or None


class DeviceHeartbeatOut(BaseModel):
    accepted: bool
    device_id: str
    last_seen_at: datetime
    server_time: datetime
