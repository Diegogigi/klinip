from types import SimpleNamespace

from app import main


def test_push_delivery_options_use_mobile_friendly_defaults():
    ttl, headers = main._push_delivery_options({"priority": "urgent"})

    assert ttl == 30 * 60
    assert headers == {"Urgency": "high"}


def test_push_delivery_options_allow_explicit_ttl_override():
    ttl, headers = main._push_delivery_options(
        {"priority": "low", "ttlSeconds": "900"}
    )

    assert ttl == 900
    assert headers == {"Urgency": "low"}


def test_send_web_push_passes_ttl_and_urgency(monkeypatch):
    captured = {}

    monkeypatch.setattr(main, "_push_configured", lambda: True)
    monkeypatch.setattr(main, "VAPID_EMAIL", "ops@example.com")
    monkeypatch.setattr(main, "VAPID_PRIVATE_KEY", "private-key")

    def fake_webpush(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(main, "webpush", fake_webpush)

    subscription = SimpleNamespace(
        endpoint="https://example.com/push",
        p256dh="p256dh-key",
        auth="auth-key",
    )

    assert main.send_web_push(subscription, {"priority": "high", "title": "Prueba"}) is True
    assert captured["ttl"] == 3 * 60 * 60
    assert captured["headers"] == {"Urgency": "high"}
    assert captured["vapid_claims"] == {"sub": "mailto:ops@example.com"}
