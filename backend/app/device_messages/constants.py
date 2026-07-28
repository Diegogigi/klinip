from __future__ import annotations


PROTOCOL_VERSION = 1
MESSAGE_TYPE = "family_non_clinical"
PRIORITY = "normal"
DEFAULT_EXPIRES_SECONDS = 7 * 24 * 60 * 60
MIN_EXPIRES_SECONDS = 5 * 60
MAX_EXPIRES_SECONDS = 30 * 24 * 60 * 60
MAX_BODY_LENGTH = 1000
MAX_INBOX_LIMIT = 100

PROGRESS_STATES = ("queued", "delivered", "announced", "heard", "acknowledged")
TERMINAL_STATES = frozenset({"acknowledged", "expired", "revoked"})
EVENT_TYPES = frozenset({"delivered", "announced", "heard", "acknowledged", "failed"})
READ_SCOPE_EVENTS = frozenset({"delivered", "announced", "heard"})
ACK_SCOPE_EVENTS = frozenset({"acknowledged", "failed"})
