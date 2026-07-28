from __future__ import annotations

from .constants import EVENT_TYPES, PROGRESS_STATES, TERMINAL_STATES


class InvalidTransition(ValueError):
    pass


def next_state(current_state: str, event_type: str) -> str:
    if event_type not in EVENT_TYPES:
        raise InvalidTransition("invalid_event_type")
    if current_state in TERMINAL_STATES:
        raise InvalidTransition("message_state_terminal")
    if event_type == "failed":
        if current_state not in {"delivered", "announced", "failed"}:
            raise InvalidTransition("invalid_state_transition")
        return "failed"

    event_rank = PROGRESS_STATES.index(event_type)
    if current_state == "failed":
        if event_type not in {"delivered", "announced", "heard"}:
            raise InvalidTransition("invalid_state_transition")
        return event_type

    current_rank = PROGRESS_STATES.index(current_state)
    if event_type == "acknowledged" and current_state != "heard":
        raise InvalidTransition("invalid_state_transition")
    if event_rank > current_rank + 1:
        raise InvalidTransition("invalid_state_transition")
    if event_rank <= current_rank:
        return current_state
    return event_type
