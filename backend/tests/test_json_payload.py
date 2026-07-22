from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from uuid import UUID

import pytest
from pydantic import BaseModel

from app.json_payload import JsonPayloadError, normalize_json_payload


class ExampleStatus(Enum):
    ready = "ready"


class ExampleAiPayload(BaseModel):
    generated_at: datetime
    labels: list[str]


def test_normalize_json_payload_supports_worker_payload_types():
    payload_uuid = UUID("12345678-1234-5678-1234-567812345678")
    payload = {
        "valid": True,
        "missing": None,
        "generated_at": datetime(2026, 7, 22, 9, 30),
        "day": date(2026, 7, 22),
        "status": ExampleStatus.ready,
        "identifier": payload_uuid,
        "amount": Decimal("42.50"),
        "items": [1, {"enabled": False}],
        "ai": ExampleAiPayload(
            generated_at=datetime(2026, 7, 22, 10, 0),
            labels=["stable"],
        ),
    }

    normalized = normalize_json_payload(payload)

    assert normalized["generated_at"] == "2026-07-22T09:30:00"
    assert normalized["day"] == "2026-07-22"
    assert normalized["status"] == "ready"
    assert normalized["identifier"] == str(payload_uuid)
    assert normalized["amount"] == 42.5
    assert normalized["missing"] is None
    assert normalized["items"] == [1, {"enabled": False}]
    assert normalized["ai"]["generated_at"] == "2026-07-22T10:00:00"
    json.dumps(normalized, allow_nan=False)


def test_normalize_json_payload_rejects_unexpected_ai_value_without_content():
    class UnexpectedAiValue:
        def __init__(self):
            self.secret = "clinical-content-must-not-leak"

    with pytest.raises(JsonPayloadError) as error:
        normalize_json_payload({"ai": UnexpectedAiValue()})

    message = str(error.value)
    assert "UnexpectedAiValue" in message
    assert "clinical-content-must-not-leak" not in message


def test_normalize_json_payload_rejects_cyclic_structures():
    payload = []
    payload.append(payload)

    with pytest.raises(JsonPayloadError, match="cyclic_reference"):
        normalize_json_payload(payload)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), Decimal("NaN")])
def test_normalize_json_payload_rejects_non_finite_numbers(value):
    with pytest.raises(JsonPayloadError, match="non_finite"):
        normalize_json_payload({"value": value})
