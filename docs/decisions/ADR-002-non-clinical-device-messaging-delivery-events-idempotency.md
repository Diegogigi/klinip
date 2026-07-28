# ADR-002: Non-Clinical Device Messaging, Delivery Events and Idempotency

- Status: accepted for local implementation
- Date: 2026-07-27
- Scope: Klinip Cloud backend v0.7.3

## Context

Klinip needs a minimal cloud contract through which an authorized family member
can leave plain-text, non-clinical messages for one or more linked Klinip One
devices. Device Identity already provides revocable device principals, grants,
scopes and human/device authentication separation.

Network download, local persistence, announcement, complete playback and human
acknowledgement are different facts. Treating an inbox response as proof that a
person heard a message would produce false status and unsafe retries.

## Decision

The server is the source of truth. `DeviceMessage` stores one non-clinical
message and its idempotency record. `DeviceMessageRecipient` creates an explicit
delivery target per device. `DeviceMessageEvent` stores independently reported
processing facts per recipient.

The initial states are `queued`, `delivered`, `announced`, `heard`,
`acknowledged`, `failed`, `expired` and `revoked`. Normal progress is:

`queued -> delivered -> announced -> heard -> acknowledged`

`acknowledged`, `expired` and `revoked` are terminal. `failed` is accepted only
after delivery or announcement and may recover through a later valid progress
event. Historical events may be recorded without moving state backwards.
`acknowledged` before `heard` is rejected.

### Inbox semantics

`GET /api/v1/device/messages` is a read-only synchronization operation for
non-expired messages. It does not create events, increment delivery attempts or
change recipient state. In particular, downloading the inbox does not mark a
message as `delivered`, `announced`, `heard` or `acknowledged`.

After the device has persisted a message locally, it reports an explicit
`delivered` event. Announcement, complete playback and user acknowledgement are
reported as separate events. Server timestamps establish order; client
timestamps are informational only.

### Identity and authorization

Human creation uses the existing human token and requires owner/admin authority
or an explicit caregiver permission `send_device_messages`. Viewers cannot send.
Device inbox access requires `messages:read`. `delivered`, `announced` and
`heard` require `messages:read`; `acknowledged` and `failed` require
`messages:ack`. Existing grants are not changed or elevated.

### Idempotency and ordering

Message creation requires `Idempotency-Key`. Only a keyed hash is stored, scoped
to user and profile, with a request fingerprint and a database uniqueness
constraint. The same key and payload returns the existing message; a changed
payload returns conflict. The record is retained with the message through its
normal data-retention lifecycle.

Each device event has a client event ID unique per recipient and a request
fingerprint. Exact replay returns the original server timestamp and resulting
state. Changed payload with the same ID returns conflict. Recipient rows are
locked for transition checks and database constraints resolve races.

The inbox uses signed, versioned keyset cursors ordered by server-created
timestamp and recipient public ID. The cursor is bound cryptographically to the
device. Its clear payload contains no message body, profile data or credentials.

### Expiration and revocation

Messages default to seven days, with limits of five minutes and thirty days.
Expiration is enforced at read/event time and never depends on a worker. A
revoked message is removed from subsequent inbox responses and all non-terminal
recipients become `revoked`. Revoking a device also revokes its pending
recipients. Evidence already `acknowledged` is retained.

### Privacy and operation

Messages are plain text with a 1,000-character limit. HTML is inert text; the
contract performs no rendering, link enrichment, Markdown processing, AI call,
audio, transcription, location processing or clinical interpretation. Audit
records contain public IDs, event types and outcomes, never message bodies,
tokens, idempotency keys, email or clinical data.

Initial transport is bounded polling with in-memory rate limits. No WebSocket,
SSE, push channel, Redis or production outbox is introduced.

## Consequences

- Delivery status remains truthful across retries and offline operation.
- Multiple devices can progress independently.
- Devices must explicitly request the two new scopes during pairing.
- In-memory rate limiting is not suitable for horizontal scaling.
- Polling may add latency; a transactional outbox and push notification can be
  evaluated later without changing the event semantics.
- Klinip One integration and UI remain future work.
