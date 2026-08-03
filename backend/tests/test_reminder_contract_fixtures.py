from __future__ import annotations

from datetime import date, datetime
import json
from pathlib import Path
import re


FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "docs"
    / "contracts"
    / "fixtures"
    / "reminders_v0.7.7.json"
)
REQUIRED_FIXTURES = {
    "reminder_once_v1",
    "reminder_daily_v1",
    "occurrence_pending_v1",
    "occurrence_snoozed_v1",
    "delivery_pending_v1",
    "delivery_announced_v1",
    "event_reminder_scope_v1",
    "event_occurrence_scope_v1",
    "event_delivery_scope_v1",
    "multiple_devices_v1",
    "america_santiago_profile_v1",
    "dst_gap_santiago_v1",
    "dst_fold_santiago_v1",
    "optimistic_version_conflict_v1",
    "duplicate_client_event_id_v1",
}
FORBIDDEN_STORAGE_KEYS = {
    "title_ciphertext",
    "body_ciphertext",
    "content_ciphertext",
    "content_nonce",
    "content_key_version",
    "content_algorithm_version",
}
SNAKE_CASE = re.compile(r"^[a-z][a-z0-9_]*$")


def _document():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _fixtures_by_id():
    document = _document()
    return {item["fixture_id"]: item for item in document["fixtures"]}


def _walk(value):
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def test_canonical_fixture_catalog_is_complete_and_unique():
    document = _document()
    ids = [item["fixture_id"] for item in document["fixtures"]]

    assert document["schema_version"] == 1
    assert document["protocol_version"] == 1
    assert len(ids) == len(set(ids))
    assert REQUIRED_FIXTURES <= set(ids)


def test_device_contract_fixtures_never_expose_cloud_storage_envelope():
    document = _document()
    keys = {
        key for value in _walk(document) if isinstance(value, dict) for key in value
    }

    assert FORBIDDEN_STORAGE_KEYS.isdisjoint(keys)


def test_fixture_dates_and_utc_timestamps_use_canonical_formats():
    document = _document()
    for value in _walk(document):
        if not isinstance(value, dict):
            continue
        for key, field_value in value.items():
            if field_value is None or not isinstance(field_value, str):
                continue
            if key.endswith("_date"):
                assert date.fromisoformat(field_value).isoformat() == field_value
            if (
                key.endswith("_utc")
                or key.endswith("_at")
                or key.endswith("_timestamp")
            ):
                parsed = datetime.fromisoformat(field_value.replace("Z", "+00:00"))
                assert field_value.endswith("Z")
                assert parsed.utcoffset().total_seconds() == 0


def test_recurrence_and_enum_values_are_versioned_snake_case():
    fixtures = _fixtures_by_id()
    for fixture_id in ("reminder_once_v1", "reminder_daily_v1"):
        payload = fixtures[fixture_id]["payload"]
        recurrence = payload["schedule"]["recurrence"]
        assert set(recurrence) == {"version", "frequency", "interval", "weekdays"}
        assert recurrence["version"] == 1

    for value in _walk(_document()):
        if not isinstance(value, dict):
            continue
        for key in (
            "origin",
            "reminder_type",
            "mode",
            "state",
            "scope",
            "event_type",
            "policy",
            "resolution",
            "detail",
        ):
            if key in value:
                assert SNAKE_CASE.fullmatch(value[key])


def test_event_targets_follow_scope_nullability_contract():
    fixtures = _fixtures_by_id()
    reminder_event = fixtures["event_reminder_scope_v1"]["payload"]
    occurrence_event = fixtures["event_occurrence_scope_v1"]["payload"]
    delivery_event = fixtures["event_delivery_scope_v1"]["payload"]

    assert reminder_event["occurrence_id"] is None
    assert reminder_event["delivery_id"] is None
    assert occurrence_event["occurrence_id"] is not None
    assert occurrence_event["delivery_id"] is None
    assert delivery_event["occurrence_id"] is not None
    assert delivery_event["delivery_id"] is not None


def test_every_delivery_fixture_has_a_concrete_occurrence():
    for fixture in _document()["fixtures"]:
        if fixture["kind"] == "delivery":
            assert fixture["payload"]["occurrence_id"]


def test_multiple_devices_have_distinct_delivery_identities():
    payload = _fixtures_by_id()["multiple_devices_v1"]["payload"]
    identities = {
        (
            payload["occurrence_id"],
            delivery["device_id"],
            delivery["delivery_revision"],
        )
        for delivery in payload["deliveries"]
    }

    assert len(identities) == len(payload["deliveries"])
    assert payload["preferred_device_id"] == "fixture-device-1"


def test_conflict_and_duplicate_fixtures_preserve_idempotency_semantics():
    fixtures = _fixtures_by_id()
    conflict = fixtures["optimistic_version_conflict_v1"]["payload"]
    duplicate = fixtures["duplicate_client_event_id_v1"]["payload"]

    assert conflict["expected_version"] < conflict["current_version"]
    assert conflict["detail"] == "version_conflict"
    assert conflict["retryable"] is False
    assert duplicate["duplicate"] is True
    assert duplicate["accepted"] is True
    assert len(duplicate["request_fingerprint"]) == 64
