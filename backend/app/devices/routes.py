from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from .. import auth, models
from .errors import DeviceError
from .rate_limit import check_device_rate_limit
from .schemas import (
    DeviceClaimIn,
    DeviceConfigOut,
    DeviceHeartbeatIn,
    DeviceHeartbeatOut,
    DeviceOut,
    DevicePairingCreate,
    DevicePairingCreatedOut,
    DevicePairingOut,
    DeviceRefreshIn,
    DeviceRefreshOut,
    DeviceRevokeOut,
    DeviceTokenOut,
    DeviceUpdateIn,
)
from .security import DevicePrincipal, hash_pairing_code, require_device_scopes
from .service import (
    cancel_pairing,
    claim_pairing,
    create_pairing,
    get_device_for_user,
    get_pairing_for_user,
    list_devices_for_user,
    record_config_read,
    record_heartbeat,
    revoke_device,
    rotate_device_refresh_token,
    serialize_device,
    update_device,
)


router = APIRouter(prefix="/api/v1")


def _device_error(exc: DeviceError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.code)


def _pairing_out(pairing: models.DevicePairing, profile: models.HealthProfile) -> dict:
    return {
        "pairing_id": pairing.public_id,
        "status": pairing.pairing_status,
        "expires_at": pairing.expires_at,
        "created_at": pairing.created_at,
        "claimed_at": pairing.claimed_at,
        "cancelled_at": pairing.cancelled_at,
        "health_profile": {"id": profile.id, "display_name": profile.full_name},
        "scopes": list(pairing.requested_scopes or []),
        "protocol_version": pairing.protocol_version,
    }


@router.post(
    "/device-pairings",
    response_model=DevicePairingCreatedOut,
    tags=["Device Pairing"],
    status_code=status.HTTP_201_CREATED,
)
def create_device_pairing(
    payload: DevicePairingCreate,
    request: Request,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    check_device_rate_limit(request, "create_pairing")
    try:
        pairing, profile, raw_code = create_pairing(db, current_user, payload)
    except DeviceError as exc:
        raise _device_error(exc) from None
    return {
        "pairing_id": pairing.public_id,
        "pairing_code": raw_code,
        "expires_at": pairing.expires_at,
        "health_profile": {"id": profile.id, "display_name": profile.full_name},
        "scopes": list(pairing.requested_scopes or []),
        "protocol_version": pairing.protocol_version,
    }


@router.get(
    "/device-pairings/{pairing_id}",
    response_model=DevicePairingOut,
    tags=["Device Pairing"],
)
def get_device_pairing(
    pairing_id: str,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        pairing, profile = get_pairing_for_user(db, current_user, pairing_id)
    except DeviceError as exc:
        raise _device_error(exc) from None
    return _pairing_out(pairing, profile)


@router.delete(
    "/device-pairings/{pairing_id}",
    tags=["Device Pairing"],
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_device_pairing(
    pairing_id: str,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        cancel_pairing(db, current_user, pairing_id)
    except DeviceError as exc:
        raise _device_error(exc) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/devices/claim",
    response_model=DeviceTokenOut,
    tags=["Device Authentication"],
)
def claim_device(
    payload: DeviceClaimIn,
    request: Request,
    db: Session = Depends(auth.get_db),
):
    check_device_rate_limit(
        request,
        "claim",
        subject=hash_pairing_code(payload.pairing_code),
    )
    try:
        (
            device,
            grant,
            _credential,
            access_token,
            refresh_token,
            access_expires_at,
            refresh_expires_at,
        ) = claim_pairing(db, payload)
    except DeviceError as exc:
        raise _device_error(exc) from None
    now = datetime.utcnow()
    return {
        "device_id": device.public_id,
        "access_token": access_token,
        "access_expires_at": access_expires_at,
        "refresh_token": refresh_token,
        "refresh_expires_at": refresh_expires_at,
        "granted_profile_id": grant.health_profile_id,
        "scopes": list(grant.scopes_json or []),
        "protocol_version": device.protocol_version,
        "server_time": now,
    }


@router.post(
    "/device-auth/refresh",
    response_model=DeviceRefreshOut,
    tags=["Device Authentication"],
)
def refresh_device_token(
    payload: DeviceRefreshIn,
    request: Request,
    db: Session = Depends(auth.get_db),
):
    check_device_rate_limit(request, "refresh")
    try:
        access_token, refresh_token, access_expires_at, refresh_expires_at = (
            rotate_device_refresh_token(db, payload.refresh_token)
        )
    except DeviceError as exc:
        raise _device_error(exc) from None
    return {
        "access_token": access_token,
        "access_expires_at": access_expires_at,
        "refresh_token": refresh_token,
        "refresh_expires_at": refresh_expires_at,
        "server_time": datetime.utcnow(),
    }


@router.get("/devices", response_model=list[DeviceOut], tags=["Devices"])
def list_devices(
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return [
        serialize_device(device, grant, profile)
        for device, grant, profile in list_devices_for_user(db, current_user)
    ]


@router.get("/devices/{device_id}", response_model=DeviceOut, tags=["Devices"])
def get_device(
    device_id: str,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        device, grant, profile = get_device_for_user(db, current_user, device_id)
    except DeviceError as exc:
        raise _device_error(exc) from None
    return serialize_device(device, grant, profile)


@router.patch("/devices/{device_id}", response_model=DeviceOut, tags=["Devices"])
def patch_device(
    device_id: str,
    payload: DeviceUpdateIn,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        device, grant, profile = update_device(
            db,
            current_user,
            device_id,
            payload,
        )
    except DeviceError as exc:
        raise _device_error(exc) from None
    return serialize_device(device, grant, profile)


@router.delete(
    "/devices/{device_id}",
    response_model=DeviceRevokeOut,
    tags=["Devices"],
)
def delete_device(
    device_id: str,
    db: Session = Depends(auth.get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    try:
        device = revoke_device(db, current_user, device_id)
    except DeviceError as exc:
        raise _device_error(exc) from None
    return {"device_id": device.public_id, "status": device.status, "revoked": True}


@router.get(
    "/device/config",
    response_model=DeviceConfigOut,
    tags=["Devices"],
)
def get_device_config(
    db: Session = Depends(auth.get_db),
    principal: DevicePrincipal = Depends(
        require_device_scopes("device:read_config", "profile:read_basic")
    ),
):
    record_config_read(db, principal)
    return {
        "device_id": principal.device.public_id,
        "label": principal.device.label,
        "status": principal.device.status,
        "profile_id": principal.profile.id,
        "profile_display_name": principal.profile.full_name,
        "scopes": sorted(principal.scopes),
        "protocol_version": principal.device.protocol_version,
        "server_time": datetime.utcnow(),
        "revoked": False,
    }


@router.post(
    "/device/heartbeat",
    response_model=DeviceHeartbeatOut,
    tags=["Devices"],
)
def device_heartbeat(
    payload: DeviceHeartbeatIn,
    request: Request,
    db: Session = Depends(auth.get_db),
    principal: DevicePrincipal = Depends(require_device_scopes("device:heartbeat")),
):
    check_device_rate_limit(request, "heartbeat")
    try:
        last_seen_at = record_heartbeat(db, principal, payload)
    except DeviceError as exc:
        raise _device_error(exc) from None
    return {
        "accepted": True,
        "device_id": principal.device.public_id,
        "last_seen_at": last_seen_at,
        "server_time": datetime.utcnow(),
    }
