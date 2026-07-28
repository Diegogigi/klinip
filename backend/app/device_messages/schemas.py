from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from .constants import (
    DEFAULT_EXPIRES_SECONDS,
    MAX_BODY_LENGTH,
    MAX_EXPIRES_SECONDS,
    MIN_EXPIRES_SECONDS,
)


class DeviceMessageCreateIn(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_BODY_LENGTH)
    requires_acknowledgement: bool = False
    expires_in_seconds: int = Field(
        default=DEFAULT_EXPIRES_SECONDS,
        ge=MIN_EXPIRES_SECONDS,
        le=MAX_EXPIRES_SECONDS,
    )
    target_device_ids: list[str] | None = Field(
        default=None, min_length=1, max_length=100
    )
    protocol_version: int = Field(default=1, ge=1, le=999)

    @field_validator("target_device_ids")
    @classmethod
    def unique_targets(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = [str(item or "").strip() for item in value]
        if any(not item or len(item) > 64 for item in cleaned):
            raise ValueError("invalid target device id")
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("duplicate target device id")
        return cleaned


class DeviceMessageEventIn(BaseModel):
    client_event_id: str = Field(min_length=1, max_length=64)
    event_type: str = Field(min_length=1, max_length=20)
    client_timestamp: datetime | None = None
    protocol_version: int = Field(default=1, ge=1, le=999)
    error_code: str | None = Field(default=None, max_length=80)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("client_event_id", "event_type", "error_code")
    @classmethod
    def clean_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split()).strip().lower()


class DeviceMessageRecipientOut(BaseModel):
    recipient_id: str
    device_id: str
    device_label: str
    current_state: str
    current_state_at: datetime


class DeviceMessageCreatedOut(BaseModel):
    message_id: str
    recipient_count: int
    created_at: datetime
    expires_at: datetime
    status: str
    recipients: list[DeviceMessageRecipientOut]
    reused_idempotency_result: bool


class DeviceMessageEventOut(BaseModel):
    accepted: bool
    duplicate: bool
    current_state: str
    server_timestamp: datetime
    message_id: str


class DeviceInboxItemOut(BaseModel):
    message_id: str
    body: str
    message_type: str
    priority: str
    requires_acknowledgement: bool
    created_at: datetime
    available_at: datetime
    expires_at: datetime
    current_state: str
    sender_display_name: str
    profile_id: int
    protocol_version: int


class DeviceInboxOut(BaseModel):
    items: list[DeviceInboxItemOut]
    next_cursor: str | None
    has_more: bool
    server_time: datetime
    polling_hint_seconds: int
