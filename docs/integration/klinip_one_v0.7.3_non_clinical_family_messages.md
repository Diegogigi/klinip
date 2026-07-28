# Klinip Cloud v0.7.3: Non-Clinical Family Messages

## 1. Objective

Provide a local backend MVP for an authorized family member to create a
non-clinical text message, for linked devices to synchronize it, and for each
device to report independently verifiable delivery lifecycle events.

## 2. Non-clinical scope

The only message type is `family_non_clinical` with priority `normal`. The
channel is not a prescription, diagnosis, emergency path, medication change,
appointment order or automated clinical instruction.

## 3. ADR

[ADR-002](../decisions/ADR-002-non-clinical-device-messaging-delivery-events-idempotency.md)
defines the authoritative state, explicit event and retry semantics.

## 4. Models

- `DeviceMessage`: body, sender/profile, availability, expiration, revocation
  and creation idempotency.
- `DeviceMessageRecipient`: one target device and independent current state.
- `DeviceMessageEvent`: immutable device report with server timestamp,
  idempotency fingerprint and resulting state.

Migration `20260727_000001` adds only these three tables and follows
`20260722_000001`.

## 5. Recipients

Creation resolves every active, protocol-compatible device with an active grant
to the profile and `messages:read`. Optional target IDs must all be eligible.
Messages with no eligible recipients are rejected. Recipient uniqueness is
enforced per message/device.

## 6. Device scopes

- `messages:read`: inbox plus `delivered`, `announced` and `heard` events.
- `messages:ack`: `acknowledged` and `failed` events.

Existing grants are unchanged and do not gain either scope automatically.

## 7. Human permission

Owners and accepted admins have implicit authority. A caregiver needs explicit
`send_device_messages`; the caregiver default list does not include it. A viewer
cannot create, list, inspect or revoke messages.

## 8. Endpoints

- `POST /api/v1/health-profiles/{profile_id}/device-messages`
- `GET /api/v1/health-profiles/{profile_id}/device-messages`
- `GET /api/v1/health-profiles/{profile_id}/device-messages/{message_id}`
- `DELETE /api/v1/health-profiles/{profile_id}/device-messages/{message_id}`
- `GET /api/v1/device/messages`
- `POST /api/v1/device/messages/{message_id}/events`

Human and device endpoints retain different token validators. Human tokens are
rejected by device routes and device tokens are rejected by human routes.

## 9. State machine

Normal progress is `queued -> delivered -> announced -> heard -> acknowledged`.
The terminal states are `acknowledged`, `expired` and `revoked`. `failed` can be
reported after delivery/announcement. An event may not skip required progress;
historical events never move state backwards.

Most importantly, inbox download does not mutate state. A message remains
`queued` after one or many inbox reads. The device must report `delivered` after
local persistence. `announced`, `heard` and `acknowledged` are later, separate
events with their own IDs and server timestamps.

## 10. Cursor

Inbox pagination uses signed version-1 keyset cursors ordered by recipient
server creation time and public ID. The signature is domain-separated and bound
to the device. Altered cursors and cursors from another device are rejected.

## 11. Creation idempotency

`Idempotency-Key` is mandatory. The server stores a keyed hash and canonical
request fingerprint under a unique user/profile/hash constraint. Exact retry
returns the original result. Reuse with changed input returns HTTP 409. The raw
key is never persisted, logged or returned.

## 12. Expiration

Default expiration is seven days, minimum five minutes and maximum thirty days.
Inbox filtering and event validation compare against server time, so an expired
message cannot be delivered even if the worker is unavailable. Human/event
access materializes pending recipients as `expired` idempotently.

## 13. Revocation

The sender or a profile owner/admin may revoke. Revocation is soft and
idempotent, blocks future inbox delivery and events, and marks non-terminal
recipients `revoked`. Existing acknowledgement evidence is retained. Device
revocation also revokes that device's pending recipients.

## 14. Offline and retry

Inbox reads are repeatable and side-effect free. Creation and events have
persistent idempotency constraints. Device events use server ordering, so a
stale client timestamp cannot reverse state.

## 15. Polling

The MVP returns a 30-second polling hint. No WebSocket, SSE or native push was
added. Clients should use bounded backoff after transport or rate-limit errors.

## 16. Privacy

Device responses include only the message contract, minimal sender display name
and profile ID already bound to the principal. They exclude email, phone,
clinical data, other relatives/devices, tokens, hashes and audit details. No
audio, transcription, location, attachment or AI data is stored.

## 17. Audit

Audited actions include creation, idempotency reuse, revocation, expiration,
accepted/duplicate/rejected events. Metadata contains IDs, event type and safe
outcome only. The message body and credentials are excluded.

## 18. Rate limits

Creation, inbox and events have separate limits. The current limiter is local
in-memory state and is not distributed; Redis remains out of scope.

## 19. Migration

Alembic has one head: `20260727_000001`. A complete schema created by the legacy
fresh-database bootstrap is accepted; a partial message schema causes a hard
failure. Local validation executes upgrade, downgrade to `20260722_000001`, and
upgrade again on an ephemeral SQLite database.

## 20. Tests

Directed tests cover permissions, scopes, target selection, input safety,
creation/event idempotency, explicit lifecycle events, side-effect-free inbox,
cursor integrity/binding, multiple devices, expiration, revocation, privacy and
OpenAPI separation. Full backend and frontend regression results are recorded
in the pull request.

## 21. Threat model

| Threat | Mitigation | Limitation and verification |
| --- | --- | --- |
| Unauthorized family/viewer | Explicit profile permission | API permission tests |
| Other-profile/non-recipient device | Principal profile and recipient binding | Returns non-enumerating not-found |
| Revoked device/grant | Device authentication revalidates DB state | Revocation tests during polling |
| Create replay | Keyed hash, fingerprint, unique constraint | Exact replay and changed-payload tests |
| Event replay | Recipient/client ID uniqueness and fingerprint | Duplicate/conflict tests |
| Altered or stolen cursor | HMAC signature and device binding | Tamper/cross-device tests; bearer theft still depends on token security |
| Message ID enumeration | Public UUID plus profile/recipient filtering | Unauthorized lookup tests |
| Scope escalation | Pairing allowlist and DB grant revalidation | Existing grants are not upgraded |
| Malicious/large payload | Plain text, control rejection, 1,000-char limit | Validation and inert-HTML tests |
| Spam | Separate rate limits | In-memory limiter is per replica |
| Out-of-order/forged acknowledgement | Server state machine and `messages:ack` | Transition/scope tests; physical user proof is future device work |
| Stolen token | Short access token and revocable device/credential | Device Identity regression tests |
| Content in logs | Sanitized audit with no body | Audit response tests |
| Offline device | Polling plus idempotent retries | Push/outbox remain future work |
| Expiration race | Server-time event check and inbox filter | Expiration tests without worker |
| Revocation/delivery race | Recipient row lock and terminal-state check | Concurrent database constraint coverage; PostgreSQL serializes row lock |

## 22. Future outbox

A transactional outbox and push wake-up may later reduce polling latency. They
must preserve the current rule that transport does not imply `delivered`.

## 23. Klinip One

No Klinip One repository or application code was modified.

## 24. UI

No human or device UI was implemented in this phase.

## 25. Next step

After draft-PR review and explicit authorization, merge and validate the cloud
contract in production before beginning a separate Klinip One integration.
