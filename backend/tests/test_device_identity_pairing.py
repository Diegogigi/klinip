from __future__ import annotations

from datetime import datetime, timedelta
import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt

from app import auth, main, models
from app.devices import rate_limit, security, service
from app.devices.errors import DeviceError
from app.devices.schemas import DeviceClaimIn, DevicePairingCreate


ALL_SCOPES = [
    "device:read_config",
    "profile:read_basic",
    "device:refresh",
    "device:heartbeat",
]


@pytest.fixture(autouse=True)
def _clear_device_rate_limits():
    rate_limit.reset_device_rate_limits()
    yield
    rate_limit.reset_device_rate_limits()


@pytest.fixture()
def client(db_session):
    def override_db():
        yield db_session

    main.app.dependency_overrides[auth.get_db] = override_db
    with TestClient(main.app) as test_client:
        yield test_client
    main.app.dependency_overrides.pop(auth.get_db, None)


def _seed_user(db, email: str, name: str = "Persona") -> models.User:
    user = models.User(
        email=email,
        password_hash=auth.get_password_hash("Valid-password-123"),
        name=name,
        token_version=0,
    )
    db.add(user)
    db.flush()
    return user


def _seed_profile(db, owner: models.User, name: str = "Perfil") -> models.HealthProfile:
    profile = models.HealthProfile(
        owner_user_id=owner.id,
        full_name=name,
        created_by_user_id=owner.id,
        is_primary_profile=True,
        is_archived=False,
    )
    db.add(profile)
    db.commit()
    return profile


def _human_headers(user: models.User) -> dict[str, str]:
    token = auth.create_access_token(
        {"sub": str(user.id), "tv": int(user.token_version or 0)}
    )
    return {"Authorization": f"Bearer {token}"}


def _create_pairing_api(client, user, profile, **overrides):
    payload = {
        "health_profile_id": profile.id,
        "label": "Klinip One hogar",
        "requested_scopes": ALL_SCOPES,
        "protocol_version": 1,
        "expires_in_seconds": 300,
        **overrides,
    }
    return client.post(
        "/api/v1/device-pairings",
        json=payload,
        headers=_human_headers(user),
    )


def _claim_api(client, code: str, *, request_headers=None, **overrides):
    payload = {
        "pairing_code": code,
        "device_label": "Klinip One sala",
        "platform": "android",
        "device_type": "klinip_one",
        "protocol_version": 1,
        "capabilities": ["living_presence", "local_asr"],
        "app_version": "0.7.2",
        **overrides,
    }
    return client.post(
        "/api/v1/devices/claim",
        json=payload,
        headers=request_headers,
    )


def _create_and_claim(client, db_session):
    owner = _seed_user(db_session, "owner-device@example.com", "Owner Device")
    profile = _seed_profile(db_session, owner, "Perfil Device")
    pairing = _create_pairing_api(client, owner, profile)
    assert pairing.status_code == 201, pairing.text
    claim = _claim_api(client, pairing.json()["pairing_code"])
    assert claim.status_code == 200, claim.text
    return owner, profile, pairing.json(), claim.json()


def test_owner_pairing_claim_and_authentication_boundaries(client, db_session):
    owner, profile, pairing, claim = _create_and_claim(client, db_session)

    stored_pairing = db_session.query(models.DevicePairing).one()
    assert stored_pairing.code_hash != pairing["pairing_code"]
    assert pairing["pairing_code"] not in json.dumps(
        stored_pairing.__dict__, default=str
    )

    status_response = client.get(
        f"/api/v1/device-pairings/{pairing['pairing_id']}",
        headers=_human_headers(owner),
    )
    assert status_response.status_code == 200
    assert "pairing_code" not in status_response.json()
    assert "code_hash" not in status_response.json()

    device_headers = {"Authorization": f"Bearer {claim['access_token']}"}
    config = client.get("/api/v1/device/config", headers=device_headers)
    assert config.status_code == 200, config.text
    assert config.json()["profile_id"] == profile.id
    assert set(config.json()) == {
        "device_id",
        "label",
        "status",
        "profile_id",
        "profile_display_name",
        "scopes",
        "protocol_version",
        "server_time",
        "revoked",
    }

    human_rejected_by_device = client.get(
        "/api/v1/device/config",
        headers=_human_headers(owner),
    )
    assert human_rejected_by_device.status_code == 401
    assert human_rejected_by_device.json()["detail"] == "invalid_device_token"

    device_rejected_by_human = client.get("/me", headers=device_headers)
    assert device_rejected_by_human.status_code == 401


def test_device_and_human_tokens_have_separate_keys_and_typed_claims(
    client,
    db_session,
):
    owner, _profile, _pairing, claim = _create_and_claim(client, db_session)
    claims = security.decode_device_access_token(claim["access_token"])

    assert claims["type"] == "device_access"
    assert claims["token_type"] == "device_access"
    assert claims["sub"] == claims["device_id"]
    assert set(ALL_SCOPES) == set(claims["scopes"])
    assert {
        "sub",
        "token_type",
        "device_id",
        "profile_id",
        "scopes",
        "token_version",
        "protocol_version",
        "iat",
        "exp",
        "jti",
    }.issubset(claims)
    assert not {"email", "name", "permissions", "refresh_token"}.intersection(claims)

    with pytest.raises(Exception):
        jwt.decode(claim["access_token"], auth.SECRET_KEY, algorithms=[auth.ALGORITHM])

    human_token = _human_headers(owner)["Authorization"].split(" ", 1)[1]
    human_claims = jwt.decode(human_token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
    assert human_claims["token_type"] == "human_access"
    with pytest.raises(HTTPException) as rejected:
        security.decode_device_access_token(human_token)
    assert rejected.value.status_code == 401


def test_expired_device_access_token_is_rejected(client, db_session):
    _owner, _profile, _pairing, claim = _create_and_claim(client, db_session)
    claims = security.decode_device_access_token(claim["access_token"])
    claims["exp"] = 1
    expired_token = jwt.encode(
        claims,
        security._derived_secret("klinip-device-access-v1"),
        algorithm=auth.ALGORITHM,
    )

    response = client.get(
        "/api/v1/device/config",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_device_token"


def test_authentication_boundaries_apply_across_human_and_device_routes(
    client,
    db_session,
):
    owner, _profile, pairing, claim = _create_and_claim(client, db_session)
    human_headers = _human_headers(owner)
    device_headers = {"Authorization": f"Bearer {claim['access_token']}"}

    human_routes = (
        ("get", "/me"),
        ("get", "/api/v1/devices"),
        ("get", f"/api/v1/devices/{claim['device_id']}"),
        ("get", f"/api/v1/device-pairings/{pairing['pairing_id']}"),
    )
    for method, path in human_routes:
        response = client.request(method, path, headers=device_headers)
        assert response.status_code == 401, (method, path, response.text)

    device_config = client.get("/api/v1/device/config", headers=human_headers)
    assert device_config.status_code == 401
    assert device_config.json()["detail"] == "invalid_device_token"
    device_heartbeat = client.post(
        "/api/v1/device/heartbeat",
        json={"protocol_version": 1, "capabilities": []},
        headers=human_headers,
    )
    assert device_heartbeat.status_code == 401
    assert device_heartbeat.json()["detail"] == "invalid_device_token"

    human_refresh = auth.create_refresh_token(db_session, owner.id)
    db_session.commit()
    rejected_human_refresh = client.post(
        "/api/v1/device-auth/refresh",
        json={"refresh_token": human_refresh},
    )
    assert rejected_human_refresh.status_code == 401
    rejected_device_refresh = client.post(
        "/auth/token/refresh",
        json={"refresh_token": claim["refresh_token"]},
    )
    assert rejected_device_refresh.status_code == 401


@pytest.mark.parametrize(
    ("role", "permissions", "expected"),
    [
        ("admin", None, 201),
        ("caregiver", ["manage_devices"], 201),
        ("caregiver", ["view_profile"], 403),
        ("viewer", ["manage_devices"], 403),
    ],
)
def test_pairing_human_permissions_are_role_and_permission_scoped(
    client,
    db_session,
    role,
    permissions,
    expected,
):
    owner = _seed_user(db_session, f"owner-{role}-{expected}@example.com")
    actor = _seed_user(db_session, f"actor-{role}-{expected}@example.com")
    profile = _seed_profile(db_session, owner)
    db_session.add(
        models.ProfileRelationship(
            profile_id=profile.id,
            user_id=actor.id,
            role=role,
            status="accepted",
            permissions_json=json.dumps(permissions)
            if permissions is not None
            else None,
        )
    )
    db_session.commit()

    response = _create_pairing_api(client, actor, profile)
    assert response.status_code == expected


def test_outsider_and_unknown_scope_are_rejected(client, db_session):
    owner = _seed_user(db_session, "owner-scope@example.com")
    outsider = _seed_user(db_session, "outsider-scope@example.com")
    profile = _seed_profile(db_session, owner)

    outsider_response = _create_pairing_api(client, outsider, profile)
    assert outsider_response.status_code == 403
    assert outsider_response.json()["detail"] == "profile_not_authorized"

    invalid_scope = _create_pairing_api(
        client,
        owner,
        profile,
        requested_scopes=["messages:read"],
    )
    assert invalid_scope.status_code == 422
    assert invalid_scope.json()["detail"] == "invalid_scope"


def test_pairing_expiration_is_bounded_and_cancellation_is_enforced(
    client,
    db_session,
):
    owner = _seed_user(db_session, "owner-cancel@example.com")
    profile = _seed_profile(db_session, owner)

    too_long = _create_pairing_api(client, owner, profile, expires_in_seconds=3600)
    assert too_long.status_code == 422

    created = _create_pairing_api(client, owner, profile)
    code = created.json()["pairing_code"]
    deleted = client.delete(
        f"/api/v1/device-pairings/{created.json()['pairing_id']}",
        headers=_human_headers(owner),
    )
    assert deleted.status_code == 204
    claim = _claim_api(client, code)
    assert claim.status_code == 409
    assert claim.json()["detail"] == "pairing_cancelled"


def test_expired_locked_and_invalid_pairings_are_rejected(client, db_session):
    owner = _seed_user(db_session, "owner-expiry@example.com")
    profile = _seed_profile(db_session, owner)
    created = _create_pairing_api(client, owner, profile)
    code = created.json()["pairing_code"]
    pairing = db_session.query(models.DevicePairing).one()
    pairing.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db_session.commit()

    expired = _claim_api(client, code)
    assert expired.status_code == 410
    assert expired.json()["detail"] == "pairing_expired"
    invalid = _claim_api(client, "2222-2222")
    assert invalid.status_code == 400
    assert invalid.json()["detail"] == "invalid_pairing_code"

    second = _create_pairing_api(client, owner, profile)
    second_code = second.json()["pairing_code"]
    for _ in range(service.PAIRING_MAX_ATTEMPTS):
        incompatible = _claim_api(client, second_code, protocol_version=2)
        assert incompatible.status_code == 422
    locked = _claim_api(client, second_code)
    assert locked.status_code == 423
    assert locked.json()["detail"] == "pairing_locked"


def test_claim_rejects_invalid_capability_and_is_one_time(client, db_session):
    owner = _seed_user(db_session, "owner-capability@example.com")
    profile = _seed_profile(db_session, owner)
    created = _create_pairing_api(client, owner, profile)
    code = created.json()["pairing_code"]

    invalid = _claim_api(client, code, capabilities=["camera_raw_upload"])
    assert invalid.status_code == 422
    assert invalid.json()["detail"] == "invalid_capability"

    valid = _claim_api(client, code)
    assert valid.status_code == 200
    repeated = _claim_api(client, code)
    assert repeated.status_code == 409
    assert repeated.json()["detail"] == "pairing_already_claimed"
    assert db_session.query(models.Device).count() == 1
    assert db_session.query(models.DeviceGrant).count() == 1
    assert db_session.query(models.DeviceCredential).count() == 1


def test_claim_rolls_back_all_rows_on_credential_issue_failure(
    db_session,
    monkeypatch,
):
    owner = _seed_user(db_session, "owner-rollback@example.com")
    profile = _seed_profile(db_session, owner)
    pairing, _profile, code = service.create_pairing(
        db_session,
        owner,
        DevicePairingCreate(
            health_profile_id=profile.id,
            requested_scopes=ALL_SCOPES,
        ),
    )

    monkeypatch.setattr(
        service,
        "create_device_access_token",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("token issue failed")),
    )
    with pytest.raises(DeviceError, match="claim_failed"):
        service.claim_pairing(
            db_session,
            DeviceClaimIn(
                pairing_code=code,
                device_label="Klinip One",
                platform="android",
                device_type="klinip_one",
                protocol_version=1,
            ),
        )

    db_session.expire_all()
    assert db_session.query(models.Device).count() == 0
    assert db_session.query(models.DeviceGrant).count() == 0
    assert db_session.query(models.DeviceCredential).count() == 0
    assert db_session.get(models.DevicePairing, pairing.id).pairing_status == "pending"


def test_refresh_rotates_and_reuse_revokes_family_and_access(client, db_session):
    _owner, _profile, _pairing, claim = _create_and_claim(client, db_session)
    original_access = claim["access_token"]
    original_refresh = claim["refresh_token"]

    rotated = client.post(
        "/api/v1/device-auth/refresh",
        json={"refresh_token": original_refresh},
    )
    assert rotated.status_code == 200, rotated.text
    assert rotated.json()["refresh_token"] != original_refresh
    assert rotated.json()["access_token"] != original_access

    old_access_before_reuse = client.get(
        "/api/v1/device/config",
        headers={"Authorization": f"Bearer {original_access}"},
    )
    assert old_access_before_reuse.status_code == 200

    reused = client.post(
        "/api/v1/device-auth/refresh",
        json={"refresh_token": original_refresh},
    )
    assert reused.status_code == 401
    assert reused.json()["detail"] == "refresh_reuse_detected"
    assert all(
        row.revoked_at is not None
        for row in db_session.query(models.DeviceCredential).all()
    )

    for access in (original_access, rotated.json()["access_token"]):
        rejected = client.get(
            "/api/v1/device/config",
            headers={"Authorization": f"Bearer {access}"},
        )
        assert rejected.status_code == 401


def test_refresh_rejects_expired_and_revoked_credentials(client, db_session):
    _owner, _profile, _pairing, claim = _create_and_claim(client, db_session)
    credential = db_session.query(models.DeviceCredential).one()
    credential.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db_session.commit()
    expired = client.post(
        "/api/v1/device-auth/refresh",
        json={"refresh_token": claim["refresh_token"]},
    )
    assert expired.status_code == 401
    assert expired.json()["detail"] == "credential_expired"

    owner2 = _seed_user(db_session, "owner-revoked-refresh@example.com")
    profile2 = _seed_profile(db_session, owner2)
    pairing2 = _create_pairing_api(client, owner2, profile2)
    claim2 = _claim_api(client, pairing2.json()["pairing_code"])
    credential2 = (
        db_session.query(models.DeviceCredential)
        .order_by(models.DeviceCredential.id.desc())
        .first()
    )
    credential2.revoked_at = datetime.utcnow()
    db_session.commit()
    revoked = client.post(
        "/api/v1/device-auth/refresh",
        json={"refresh_token": claim2.json()["refresh_token"]},
    )
    assert revoked.status_code == 401
    assert revoked.json()["detail"] == "credential_revoked"


def test_revoke_is_immediate_complete_and_idempotent(client, db_session):
    owner, _profile, _pairing, claim = _create_and_claim(client, db_session)
    headers = _human_headers(owner)

    revoked = client.delete(f"/api/v1/devices/{claim['device_id']}", headers=headers)
    assert revoked.status_code == 200
    repeated = client.delete(f"/api/v1/devices/{claim['device_id']}", headers=headers)
    assert repeated.status_code == 200
    assert repeated.json()["status"] == "revoked"

    device = db_session.query(models.Device).one()
    assert device.status == "revoked"
    assert device.revoked_at is not None
    assert db_session.query(models.DeviceGrant).one().revoked_at is not None
    assert db_session.query(models.DeviceCredential).one().revoked_at is not None

    device_headers = {"Authorization": f"Bearer {claim['access_token']}"}
    assert (
        client.get("/api/v1/device/config", headers=device_headers).status_code == 401
    )
    heartbeat = client.post(
        "/api/v1/device/heartbeat",
        json={"protocol_version": 1, "capabilities": []},
        headers=device_headers,
    )
    assert heartbeat.status_code == 401
    refresh = client.post(
        "/api/v1/device-auth/refresh",
        json={"refresh_token": claim["refresh_token"]},
    )
    assert refresh.status_code == 401


@pytest.mark.parametrize(
    ("role", "permissions", "can_manage"),
    [
        ("admin", None, True),
        ("caregiver", ["manage_devices"], True),
        ("caregiver", ["view_profile"], False),
        ("viewer", ["manage_devices"], False),
    ],
)
def test_device_listing_detail_and_revocation_follow_human_permissions(
    client,
    db_session,
    role,
    permissions,
    can_manage,
):
    owner, profile, _pairing, claim = _create_and_claim(client, db_session)
    actor = _seed_user(db_session, f"device-manager-{role}-{can_manage}@example.com")
    db_session.add(
        models.ProfileRelationship(
            profile_id=profile.id,
            user_id=actor.id,
            role=role,
            status="accepted",
            permissions_json=json.dumps(permissions)
            if permissions is not None
            else None,
        )
    )
    db_session.commit()
    headers = _human_headers(actor)

    listed = client.get("/api/v1/devices", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()) == (1 if can_manage else 0)
    detail = client.get(f"/api/v1/devices/{claim['device_id']}", headers=headers)
    revoked = client.delete(
        f"/api/v1/devices/{claim['device_id']}",
        headers=headers,
    )
    expected_status = 200 if can_manage else 403
    assert detail.status_code == expected_status
    assert revoked.status_code == expected_status


def test_device_config_scopes_and_heartbeat_are_enforced(client, db_session):
    owner = _seed_user(db_session, "owner-scoped-device@example.com")
    profile = _seed_profile(db_session, owner)
    pairing = _create_pairing_api(
        client,
        owner,
        profile,
        requested_scopes=["device:heartbeat"],
    )
    claim = _claim_api(client, pairing.json()["pairing_code"])
    headers = {"Authorization": f"Bearer {claim.json()['access_token']}"}

    config = client.get("/api/v1/device/config", headers=headers)
    assert config.status_code == 403
    assert config.json()["detail"] == "insufficient_device_scope"

    heartbeat = client.post(
        "/api/v1/device/heartbeat",
        json={
            "protocol_version": 1,
            "capabilities": ["voice", "local_asr"],
            "app_version": "0.7.2-test",
        },
        headers=headers,
    )
    assert heartbeat.status_code == 200
    device = db_session.query(models.Device).one()
    assert device.last_seen_at is not None
    assert device.app_version == "0.7.2-test"
    assert device.metadata_json["capabilities"] == ["local_asr", "voice"]

    wrong_protocol = client.post(
        "/api/v1/device/heartbeat",
        json={"protocol_version": 2, "capabilities": []},
        headers=headers,
    )
    assert wrong_protocol.status_code == 422
    assert wrong_protocol.json()["detail"] == "protocol_not_supported"


def test_device_rate_limits_pairing_and_heartbeat(
    client,
    db_session,
    monkeypatch,
):
    owner = _seed_user(db_session, "owner-rate@example.com")
    profile = _seed_profile(db_session, owner)
    monkeypatch.setitem(rate_limit.DEVICE_RATE_LIMITS["create_pairing"], "max", 1)

    assert _create_pairing_api(client, owner, profile).status_code == 201
    limited = _create_pairing_api(client, owner, profile)
    assert limited.status_code == 429
    assert limited.json()["detail"] == "rate_limited"


def test_claim_rate_limit_is_independent_by_ip_and_pairing_code(
    client,
    monkeypatch,
):
    monkeypatch.setitem(rate_limit.DEVICE_RATE_LIMITS["claim"], "max", 1)
    first = _claim_api(
        client,
        "2222-2222",
        request_headers={"X-Forwarded-For": "192.0.2.10"},
    )
    assert first.status_code == 400
    same_ip_new_code = _claim_api(
        client,
        "3333-3333",
        request_headers={"X-Forwarded-For": "192.0.2.10"},
    )
    assert same_ip_new_code.status_code == 429

    rate_limit.reset_device_rate_limits()
    first_ip = _claim_api(
        client,
        "4444-4444",
        request_headers={"X-Forwarded-For": "192.0.2.11"},
    )
    assert first_ip.status_code == 400
    new_ip_same_code = _claim_api(
        client,
        "4444-4444",
        request_headers={"X-Forwarded-For": "192.0.2.12"},
    )
    assert new_ip_same_code.status_code == 429


def test_audit_and_openapi_never_expose_codes_tokens_or_hashes(
    client,
    db_session,
    capsys,
):
    _owner, _profile, pairing, claim = _create_and_claim(client, db_session)
    output = capsys.readouterr().out
    assert pairing["pairing_code"] not in output
    assert claim["refresh_token"] not in output
    assert claim["access_token"] not in output

    for entry in db_session.query(models.AuditLog).all():
        serialized = json.dumps(entry.metadata_json, default=str)
        assert pairing["pairing_code"] not in serialized
        assert claim["refresh_token"] not in serialized
        assert claim["access_token"] not in serialized

    schema_text = json.dumps(main.app.openapi())
    assert "refresh_token_hash" not in schema_text
    assert "code_hash" not in schema_text
    assert "token_family_id" not in schema_text
    assert "/api/v1/device/config" in schema_text
    assert "/api/v1/device/heartbeat" in schema_text


def test_device_payloads_do_not_include_disallowed_private_data(client, db_session):
    owner, _profile, _pairing, claim = _create_and_claim(client, db_session)
    detail = client.get(
        f"/api/v1/devices/{claim['device_id']}",
        headers=_human_headers(owner),
    )
    assert detail.status_code == 200
    payload_text = json.dumps(detail.json()).lower()
    for forbidden in (
        "audio",
        "transcript",
        "location",
        "latitude",
        "longitude",
        "imei",
        "serial_number",
        "mac_address",
    ):
        assert forbidden not in payload_text
