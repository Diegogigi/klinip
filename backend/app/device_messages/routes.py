from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from .. import auth, models
from ..devices.errors import DeviceError
from ..devices.rate_limit import check_device_rate_limit
from ..devices.security import (
    DevicePrincipal,
    get_current_device,
    require_device_scopes,
)
from .constants import MAX_INBOX_LIMIT
from .schemas import (
    DeviceInboxOut,
    DeviceMessageCreateIn,
    DeviceMessageCreatedOut,
    DeviceMessageEventIn,
    DeviceMessageEventOut,
)
from .service import (
    create_message,
    get_inbox,
    get_message_detail,
    list_messages,
    record_event,
    revoke_message,
    serialize_created,
)


router = APIRouter(prefix="/api/v1")


def _http_error(exc: DeviceError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.code)


@router.post(
    "/health-profiles/{profile_id}/device-messages",
    response_model=DeviceMessageCreatedOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Device Messages"],
)
def create_device_message(
    profile_id: int,
    payload: DeviceMessageCreateIn,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    check_device_rate_limit(request, "create_message", subject=str(current_user.id))
    try:
        message, reused = create_message(
            db, current_user, profile_id, payload, idempotency_key or ""
        )
        return serialize_created(db, message, reused)
    except DeviceError as exc:
        raise _http_error(exc) from None


@router.get(
    "/health-profiles/{profile_id}/device-messages",
    tags=["Device Messages"],
)
def get_device_messages(
    profile_id: int,
    state_filter: str | None = Query(default=None, alias="state"),
    device_id: str | None = None,
    message_id: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        return list_messages(
            db,
            current_user,
            profile_id,
            state=state_filter,
            device_id=device_id,
            message_id=message_id,
            created_from=created_from,
            created_to=created_to,
            limit=limit,
            offset=offset,
        )
    except DeviceError as exc:
        raise _http_error(exc) from None


@router.get(
    "/health-profiles/{profile_id}/device-messages/{message_id}",
    tags=["Device Messages"],
)
def get_device_message(
    profile_id: int,
    message_id: str,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        return get_message_detail(db, current_user, profile_id, message_id)
    except DeviceError as exc:
        raise _http_error(exc) from None


@router.delete(
    "/health-profiles/{profile_id}/device-messages/{message_id}",
    tags=["Device Messages"],
)
def delete_device_message(
    profile_id: int,
    message_id: str,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        return revoke_message(db, current_user, profile_id, message_id)
    except DeviceError as exc:
        raise _http_error(exc) from None


@router.get(
    "/device/messages",
    response_model=DeviceInboxOut,
    tags=["Device Messages"],
)
def get_device_message_inbox(
    request: Request,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=MAX_INBOX_LIMIT),
    protocol_version: int = Query(default=1, ge=1, le=999),
    include_terminal: bool = False,
    db: Session = Depends(auth.get_db),
    principal: DevicePrincipal = Depends(require_device_scopes("messages:read")),
):
    check_device_rate_limit(
        request, "message_inbox", subject=principal.device.public_id
    )
    try:
        return get_inbox(
            db,
            principal,
            cursor=cursor,
            limit=limit,
            protocol_version=protocol_version,
            include_terminal=include_terminal,
        )
    except DeviceError as exc:
        raise _http_error(exc) from None


@router.post(
    "/device/messages/{message_id}/events",
    response_model=DeviceMessageEventOut,
    tags=["Device Message Events"],
)
def create_device_message_event(
    message_id: str,
    payload: DeviceMessageEventIn,
    request: Request,
    db: Session = Depends(auth.get_db),
    principal: DevicePrincipal = Depends(get_current_device),
):
    check_device_rate_limit(
        request, "message_event", subject=principal.device.public_id
    )
    try:
        return record_event(db, principal, message_id, payload)
    except DeviceError as exc:
        raise _http_error(exc) from None
