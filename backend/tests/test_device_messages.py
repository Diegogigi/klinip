from __future__ import annotations

from datetime import datetime, timedelta
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app import auth, main, models
from app.devices import rate_limit


MESSAGE_SCOPES = [
    "device:read_config",
    "profile:read_basic",
    "device:refresh",
    "device:heartbeat",
    "messages:read",
    "messages:ack",
]


@pytest.fixture(autouse=True)
def _clear_rate_limits():
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


def _user(db, email: str, name: str = "Persona") -> models.User:
    user = models.User(
        email=email,
        password_hash=auth.get_password_hash("Valid-password-123"),
        name=name,
        token_version=0,
    )
    db.add(user)
    db.flush()
    return user


def _profile(db, owner: models.User, name: str = "Perfil") -> models.HealthProfile:
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


def _human_headers(user: models.User, key: str | None = None) -> dict[str, str]:
    token = auth.create_access_token(
        {"sub": str(user.id), "tv": int(user.token_version or 0)}
    )
    headers = {"Authorization": f"Bearer {token}"}
    if key:
        headers["Idempotency-Key"] = key
    return headers


def _claim_device(client, user, profile, *, scopes=None, label="Klinip One"):
    pairing = client.post(
        "/api/v1/device-pairings",
        json={
            "health_profile_id": profile.id,
            "label": label,
            "requested_scopes": scopes or MESSAGE_SCOPES,
            "protocol_version": 1,
            "expires_in_seconds": 300,
        },
        headers=_human_headers(user),
    )
    assert pairing.status_code == 201, pairing.text
    claim = client.post(
        "/api/v1/devices/claim",
        json={
            "pairing_code": pairing.json()["pairing_code"],
            "device_label": label,
            "platform": "android",
            "device_type": "klinip_one",
            "protocol_version": 1,
            "capabilities": ["living_presence", "local_asr"],
            "app_version": "0.7.3",
        },
    )
    assert claim.status_code == 200, claim.text
    return claim.json(), {"Authorization": f"Bearer {claim.json()['access_token']}"}


def _create_message(client, owner, profile, *, key="message-key", **changes):
    payload = {
        "body": "Hola, te llamo en la tarde.",
        "requires_acknowledgement": True,
        "expires_in_seconds": 3600,
        "protocol_version": 1,
        **changes,
    }
    return client.post(
        f"/api/v1/health-profiles/{profile.id}/device-messages",
        json=payload,
        headers=_human_headers(owner, key),
    )


def _event(client, device_headers, message_id, event_type, event_id, **changes):
    payload = {
        "client_event_id": event_id,
        "event_type": event_type,
        "protocol_version": 1,
        **changes,
    }
    return client.post(
        f"/api/v1/device/messages/{message_id}/events",
        json=payload,
        headers=device_headers,
    )


def _setup(client, db_session, *, scopes=None):
    owner = _user(db_session, "owner-messages@example.com", "Diego")
    profile = _profile(db_session, owner, "Casa")
    claim, device_headers = _claim_device(client, owner, profile, scopes=scopes)
    return owner, profile, claim, device_headers


def test_owner_create_is_idempotent_and_does_not_expose_secrets(client, db_session):
    owner, profile, _claim, _headers = _setup(client, db_session)
    first = _create_message(client, owner, profile, key="private-raw-key")
    second = _create_message(client, owner, profile, key="private-raw-key")

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["message_id"] == second.json()["message_id"]
    assert first.json()["reused_idempotency_result"] is False
    assert second.json()["reused_idempotency_result"] is True
    assert db_session.query(models.DeviceMessage).count() == 1
    assert db_session.query(models.DeviceMessageRecipient).count() == 1
    serialized = json.dumps(second.json())
    assert "private-raw-key" not in serialized
    assert "idempotency_key_hash" not in serialized
    audit_payload = json.dumps(
        [entry.metadata_json for entry in db_session.query(models.AuditLog).all()]
    )
    assert "private-raw-key" not in audit_payload
    assert "Hola, te llamo" not in audit_payload


def test_same_idempotency_key_with_different_payload_conflicts(client, db_session):
    owner, profile, _claim, _headers = _setup(client, db_session)
    assert _create_message(client, owner, profile, key="same").status_code == 201
    conflict = _create_message(
        client, owner, profile, key="same", body="Otro contenido"
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "idempotency_conflict"
    assert db_session.query(models.DeviceMessage).count() == 1


def test_creation_idempotency_constraint_closes_transaction_races(client, db_session):
    owner, profile, _claim, _headers = _setup(client, db_session)
    assert _create_message(client, owner, profile, key="race-key").status_code == 201
    stored = db_session.query(models.DeviceMessage).one()
    db_session.add(
        models.DeviceMessage(
            public_id=str(uuid.uuid4()),
            health_profile_id=stored.health_profile_id,
            sender_user_id=stored.sender_user_id,
            message_type=stored.message_type,
            body=stored.body,
            priority=stored.priority,
            requires_acknowledgement=stored.requires_acknowledgement,
            created_at=stored.created_at,
            available_at=stored.available_at,
            expires_at=stored.expires_at,
            idempotency_key_hash=stored.idempotency_key_hash,
            request_fingerprint=stored.request_fingerprint,
            protocol_version=stored.protocol_version,
            metadata_json={},
            updated_at=stored.updated_at,
        )
    )
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()
    assert db_session.query(models.DeviceMessage).count() == 1


@pytest.mark.parametrize(
    ("role", "permissions", "expected"),
    [
        ("admin", [], 201),
        ("caregiver", ["send_device_messages"], 201),
        ("caregiver", [], 403),
        ("viewer", ["send_device_messages"], 403),
    ],
)
def test_human_message_permissions(client, db_session, role, permissions, expected):
    owner, profile, _claim, _headers = _setup(client, db_session)
    actor = _user(db_session, f"{role}-{expected}@example.com")
    db_session.add(
        models.ProfileRelationship(
            profile_id=profile.id,
            user_id=actor.id,
            role=role,
            status="accepted",
            permissions_json=json.dumps(permissions),
        )
    )
    db_session.commit()
    response = _create_message(client, actor, profile, key=f"{role}-{expected}")
    assert response.status_code == expected, response.text


@pytest.mark.parametrize(
    ("payload", "expected_detail"),
    [
        ({"body": "   "}, None),
        ({"body": "x" * 1001}, None),
        ({"body": "hola\u0000mundo"}, None),
        ({"protocol_version": 2}, "protocol_not_supported"),
    ],
)
def test_message_input_validation(client, db_session, payload, expected_detail):
    owner, profile, _claim, _headers = _setup(client, db_session)
    response = _create_message(
        client, owner, profile, key=str(len(str(payload))), **payload
    )
    assert response.status_code == 422
    if expected_detail:
        assert response.json()["detail"] == expected_detail


def test_html_is_plain_text_and_no_recipient_is_rejected(client, db_session):
    owner = _user(db_session, "no-device@example.com")
    profile = _profile(db_session, owner)
    no_recipient = _create_message(client, owner, profile, body="Mensaje")
    assert no_recipient.status_code == 422
    assert no_recipient.json()["detail"] == "no_eligible_devices"

    _claim_device(client, owner, profile)
    html = _create_message(
        client, owner, profile, key="html", body="<script>alert(1)</script>"
    )
    assert html.status_code == 201
    stored = db_session.query(models.DeviceMessage).one()
    assert stored.body == "<script>alert(1)</script>"


def test_target_must_be_an_eligible_device_for_profile(client, db_session):
    owner, profile, claim, _headers = _setup(client, db_session)
    target = _create_message(
        client,
        owner,
        profile,
        target_device_ids=[claim["device_id"]],
    )
    assert target.status_code == 201
    rejected = _create_message(
        client,
        owner,
        profile,
        key="bad-target",
        target_device_ids=["00000000-0000-0000-0000-000000000000"],
    )
    assert rejected.status_code == 404
    assert rejected.json()["detail"] == "target_device_not_eligible"


def test_inbox_download_has_no_state_or_event_side_effects(client, db_session):
    owner, profile, _claim, device_headers = _setup(client, db_session)
    created = _create_message(client, owner, profile)
    message_id = created.json()["message_id"]
    recipient = db_session.query(models.DeviceMessageRecipient).one()
    original_state_at = recipient.current_state_at
    original_version = recipient.version

    first = client.get("/api/v1/device/messages", headers=device_headers)
    second = client.get("/api/v1/device/messages", headers=device_headers)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["items"][0]["message_id"] == message_id
    assert first.json()["items"][0]["current_state"] == "queued"
    db_session.expire_all()
    recipient = db_session.query(models.DeviceMessageRecipient).one()
    assert recipient.current_state == "queued"
    assert recipient.current_state_at == original_state_at
    assert recipient.version == original_version
    assert recipient.delivery_attempts == 0
    assert recipient.last_event_public_id is None
    assert db_session.query(models.DeviceMessageEvent).count() == 0


def test_human_detail_proves_repeated_inbox_downloads_are_read_only(client, db_session):
    owner, profile, _claim, device_headers = _setup(client, db_session)
    message_id = _create_message(client, owner, profile).json()["message_id"]
    detail_url = f"/api/v1/health-profiles/{profile.id}/device-messages/{message_id}"
    human_headers = _human_headers(owner)

    before = client.get(detail_url, headers=human_headers)
    assert before.status_code == 200, before.text
    before_recipient = before.json()["recipients"][0]
    assert before_recipient["current_state"] == "queued"
    assert before_recipient["version"] == 1
    assert before_recipient["delivery_attempts"] == 0
    assert before.json()["events"] == []

    for _ in range(3):
        inbox = client.get("/api/v1/device/messages", headers=device_headers)
        assert inbox.status_code == 200, inbox.text
        assert inbox.json()["items"][0]["current_state"] == "queued"

    after = client.get(detail_url, headers=human_headers)
    assert after.status_code == 200, after.text
    after_recipient = after.json()["recipients"][0]
    assert after_recipient == before_recipient
    assert after.json()["events"] == []


def test_delivery_announcement_heard_and_ack_are_distinct_events(client, db_session):
    owner, profile, _claim, device_headers = _setup(client, db_session)
    created = _create_message(client, owner, profile)
    message_id = created.json()["message_id"]

    expected = [
        ("delivered", "delivered"),
        ("announced", "announced"),
        ("heard", "heard"),
        ("acknowledged", "acknowledged"),
    ]
    timestamps = []
    for index, (event_type, state) in enumerate(expected):
        response = _event(
            client, device_headers, message_id, event_type, f"event-{index}"
        )
        assert response.status_code == 200, response.text
        assert response.json()["current_state"] == state
        timestamps.append(response.json()["server_timestamp"])

    events = (
        db_session.query(models.DeviceMessageEvent)
        .order_by(models.DeviceMessageEvent.id)
        .all()
    )
    assert [event.event_type for event in events] == [item[0] for item in expected]
    assert len(set(event.public_id for event in events)) == 4
    recipient = db_session.query(models.DeviceMessageRecipient).one()
    assert recipient.current_state == "acknowledged"
    assert recipient.delivery_attempts == 1
    assert timestamps == sorted(timestamps)


def test_event_idempotency_conflict_and_invalid_order(client, db_session):
    owner, profile, _claim, device_headers = _setup(client, db_session)
    message_id = _create_message(client, owner, profile).json()["message_id"]
    early_ack = _event(client, device_headers, message_id, "acknowledged", "too-early")
    assert early_ack.status_code == 409

    first = _event(client, device_headers, message_id, "delivered", "same-event")
    duplicate = _event(client, device_headers, message_id, "delivered", "same-event")
    conflict = _event(client, device_headers, message_id, "announced", "same-event")
    assert first.status_code == 200
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True
    assert duplicate.json()["server_timestamp"] == first.json()["server_timestamp"]
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "client_event_id_conflict"
    assert db_session.query(models.DeviceMessageEvent).count() == 1


def test_event_idempotency_constraint_closes_transaction_races(client, db_session):
    owner, profile, _claim, device_headers = _setup(client, db_session)
    message_id = _create_message(client, owner, profile).json()["message_id"]
    assert (
        _event(
            client, device_headers, message_id, "delivered", "race-event"
        ).status_code
        == 200
    )
    stored = db_session.query(models.DeviceMessageEvent).one()
    db_session.add(
        models.DeviceMessageEvent(
            public_id=str(uuid.uuid4()),
            message_id=stored.message_id,
            recipient_id=stored.recipient_id,
            device_id=stored.device_id,
            event_type=stored.event_type,
            client_event_id=stored.client_event_id,
            request_fingerprint=stored.request_fingerprint,
            resulting_state=stored.resulting_state,
            server_timestamp=stored.server_timestamp,
            protocol_version=stored.protocol_version,
            metadata_json={},
            created_at=stored.created_at,
        )
    )
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()
    assert db_session.query(models.DeviceMessageEvent).count() == 1


def test_failed_requires_ack_scope_and_valid_predecessor(client, db_session):
    owner, profile, _claim, read_headers = _setup(
        client,
        db_session,
        scopes=["messages:read"],
    )
    message_id = _create_message(client, owner, profile).json()["message_id"]
    assert _event(client, read_headers, message_id, "delivered", "d").status_code == 200
    forbidden = _event(
        client,
        read_headers,
        message_id,
        "failed",
        "f",
        error_code="audio_output_failed",
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == "insufficient_device_scope"


def test_failed_is_an_explicit_recoverable_event(client, db_session):
    owner, profile, _claim, device_headers = _setup(client, db_session)
    message_id = _create_message(client, owner, profile).json()["message_id"]
    assert (
        _event(client, device_headers, message_id, "delivered", "delivery").status_code
        == 200
    )
    failed = _event(
        client,
        device_headers,
        message_id,
        "failed",
        "failure",
        error_code="audio_output_failed",
    )
    recovered = _event(
        client,
        device_headers,
        message_id,
        "announced",
        "announcement-retry",
    )
    assert failed.status_code == 200
    assert failed.json()["current_state"] == "failed"
    assert recovered.status_code == 200
    assert recovered.json()["current_state"] == "announced"
    assert [
        event.event_type
        for event in db_session.query(models.DeviceMessageEvent)
        .order_by(models.DeviceMessageEvent.id)
        .all()
    ] == ["delivered", "failed", "announced"]


def test_cursor_is_stable_signed_and_bound_to_device(client, db_session):
    owner, profile, _claim, headers_one = _setup(client, db_session)
    _claim_two, headers_two = _claim_device(client, owner, profile, label="Segundo")
    for index in range(3):
        assert (
            _create_message(client, owner, profile, key=f"cursor-{index}").status_code
            == 201
        )

    first = client.get("/api/v1/device/messages?limit=1", headers=headers_one)
    cursor = first.json()["next_cursor"]
    repeat = client.get(
        f"/api/v1/device/messages?limit=1&cursor={cursor}", headers=headers_one
    )
    repeated_again = client.get(
        f"/api/v1/device/messages?limit=1&cursor={cursor}", headers=headers_one
    )
    assert repeat.json()["items"] == repeated_again.json()["items"]
    assert (
        repeat.json()["items"][0]["message_id"]
        != first.json()["items"][0]["message_id"]
    )

    tampered = cursor[:-1] + ("A" if cursor[-1] != "A" else "B")
    assert (
        client.get(
            f"/api/v1/device/messages?cursor={tampered}", headers=headers_one
        ).status_code
        == 400
    )
    cross_device = client.get(
        f"/api/v1/device/messages?cursor={cursor}", headers=headers_two
    )
    assert cross_device.status_code == 400
    assert cross_device.json()["detail"] == "invalid_cursor"


def test_human_token_and_missing_scope_are_rejected_by_inbox(client, db_session):
    owner, profile, _claim, no_message_headers = _setup(
        client,
        db_session,
        scopes=["device:read_config", "profile:read_basic"],
    )
    human = client.get("/api/v1/device/messages", headers=_human_headers(owner))
    device = client.get("/api/v1/device/messages", headers=no_message_headers)
    assert human.status_code == 401
    assert human.json()["detail"] == "invalid_device_token"
    assert device.status_code == 403
    assert device.json()["detail"] == "insufficient_device_scope"


def test_expired_and_revoked_messages_are_not_delivered(client, db_session):
    owner, profile, _claim, device_headers = _setup(client, db_session)
    message_id = _create_message(client, owner, profile).json()["message_id"]
    message = db_session.query(models.DeviceMessage).one()
    message.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db_session.commit()
    inbox = client.get("/api/v1/device/messages", headers=device_headers)
    assert inbox.status_code == 200
    assert inbox.json()["items"] == []
    expired_event = _event(client, device_headers, message_id, "delivered", "late")
    assert expired_event.status_code == 410
    assert expired_event.json()["detail"] == "message_expired"
    db_session.expire_all()
    assert (
        db_session.query(models.DeviceMessageRecipient).one().current_state == "expired"
    )
    human_list = client.get(
        f"/api/v1/health-profiles/{profile.id}/device-messages?state=expired",
        headers=_human_headers(owner),
    )
    assert human_list.status_code == 200
    assert [item["message_id"] for item in human_list.json()["items"]] == [message_id]


def test_sender_revocation_is_idempotent_and_blocks_events(client, db_session):
    owner, profile, _claim, device_headers = _setup(client, db_session)
    message_id = _create_message(client, owner, profile).json()["message_id"]
    url = f"/api/v1/health-profiles/{profile.id}/device-messages/{message_id}"
    first = client.delete(url, headers=_human_headers(owner))
    second = client.delete(url, headers=_human_headers(owner))
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["revoked_at"] == second.json()["revoked_at"]
    assert (
        client.get("/api/v1/device/messages", headers=device_headers).json()["items"]
        == []
    )
    event = _event(client, device_headers, message_id, "delivered", "after-revoke")
    assert event.status_code == 409
    assert event.json()["detail"] == "message_revoked"
    assert (
        db_session.query(models.DeviceMessageRecipient).one().current_state == "revoked"
    )


def test_device_revocation_revokes_pending_recipient_and_access(client, db_session):
    owner, profile, claim, device_headers = _setup(client, db_session)
    _create_message(client, owner, profile)
    revoked = client.delete(
        f"/api/v1/devices/{claim['device_id']}",
        headers=_human_headers(owner),
    )
    assert revoked.status_code == 200
    db_session.expire_all()
    assert (
        db_session.query(models.DeviceMessageRecipient).one().current_state == "revoked"
    )
    assert (
        client.get("/api/v1/device/messages", headers=device_headers).status_code == 401
    )


def test_multiple_devices_keep_independent_states_and_human_timeline(
    client, db_session
):
    owner, profile, claim_one, headers_one = _setup(client, db_session)
    claim_two, headers_two = _claim_device(client, owner, profile, label="Dormitorio")
    message_id = _create_message(client, owner, profile).json()["message_id"]
    assert (
        _event(client, headers_one, message_id, "delivered", "one").status_code == 200
    )
    detail = client.get(
        f"/api/v1/health-profiles/{profile.id}/device-messages/{message_id}",
        headers=_human_headers(owner),
    )
    assert detail.status_code == 200
    states = {
        item["device_id"]: item["current_state"] for item in detail.json()["recipients"]
    }
    assert states == {
        claim_one["device_id"]: "delivered",
        claim_two["device_id"]: "queued",
    }
    assert detail.json()["events"][0]["event_type"] == "delivered"
    assert "idempotency_key_hash" not in json.dumps(detail.json())
    assert "email" not in json.dumps(detail.json()).lower()
    assert (
        client.get("/api/v1/device/messages", headers=headers_two).json()["items"][0][
            "current_state"
        ]
        == "queued"
    )


def test_openapi_separates_human_and_device_message_contracts(client):
    schema = client.get("/openapi.json").json()
    assert "/api/v1/health-profiles/{profile_id}/device-messages" in schema["paths"]
    assert "/api/v1/device/messages" in schema["paths"]
    assert "/api/v1/device/messages/{message_id}/events" in schema["paths"]
    event_security = schema["paths"]["/api/v1/device/messages/{message_id}/events"][
        "post"
    ]
    assert "Device Message Events" in event_security["tags"]
