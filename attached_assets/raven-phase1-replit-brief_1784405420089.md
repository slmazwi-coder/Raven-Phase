# Raven — Phase 1 Backend Brief (for Replit Agent)

## Context
Raven is a closed, invite-only privacy-focused chat app for a specific community of ~150 people who discuss sensitive matters. This phase builds the backend foundation only — no chat UI yet. Distribution is a sideloaded/TestFlight mobile app (not App Store), so the backend must not assume any App Store–specific services.

Brand: app name **Raven**, colours orange + plum-black (relevant only if you scaffold any admin web UI placeholder — not a priority this phase).

## Tech stack
- **Language/runtime**: Node.js + TypeScript
- **Database**: PostgreSQL
- **Cache/session**: Redis
- **Real-time**: WebSocket server (plain `ws` or Socket.IO — your choice, but document which)
- **SMS**: Twilio (or similar) for OTP delivery
- **Encryption**: prep for libsignal integration (see Task 4) — don't fully implement the protocol yet, just the data model hooks

## Task 1 — Database schema
Design and implement tables for:

**members**
- id (uuid, pk)
- full_name
- cell_number (unique, E.164 format)
- email (nullable — recovery contact only, not a credential)
- role (enum: admin, moderator, member)
- status (enum: pending, active, suspended, removed)
- created_at, updated_at

**devices**
- id (uuid, pk)
- member_id (fk → members)
- platform (enum: ios, android)
- device_identifier (attestation key/hash — placeholder field for now, real App Attest/Play Integrity binding comes in a later phase)
- allow_listed (bool, default true)
- registered_at
- revoked_at (nullable)

**enrollment_invites**
- id (uuid, pk)
- cell_number
- invited_by (fk → members, admin who created the invite)
- token (single-use, cryptographically random)
- expires_at (48 hours from creation)
- used_at (nullable)
- created_at

**otp_codes**
- id (uuid, pk)
- cell_number
- code_hash (never store plaintext OTP)
- expires_at (5–10 minutes)
- attempts (int, default 0 — for rate limiting/lockout)
- verified_at (nullable)

**groups**
- id (uuid, pk)
- name
- created_by (fk → members)
- created_at

**group_members**
- group_id (fk → groups)
- member_id (fk → members)
- role_in_group (enum: admin, moderator, member)
- joined_at

Leave `messages` and `action_items` tables as stubs only (empty migration placeholders) — full schema for those comes in Phase 2/4. Don't build chat functionality this phase.

## Task 2 — Enrollment flow (build this end-to-end, fully working)
1. `POST /admin/invites` (admin-only, auth required) — creates an `enrollment_invites` row for a given cell number, returns a shareable enrollment link/token. No public self-signup endpoint should exist.
2. `POST /enroll/verify-invite` — takes the invite token, checks it's unused and unexpired, returns basic info (community name) to show the invitee before they proceed.
3. `POST /enroll/request-otp` — takes cell number, sends SMS OTP via Twilio, stores hashed code in `otp_codes` with expiry. Rate-limit: max 3 requests per number per hour.
4. `POST /enroll/verify-otp` — takes cell number + code, checks against stored hash, checks expiry and attempt count (lock out after 5 failed attempts). On success, marks the invite as used, creates the `members` row (status: active), issues a session/auth token.
5. `POST /enroll/register-device` — called right after successful OTP verification, from the actual mobile client. Takes platform + a placeholder device identifier, creates a `devices` row tied to the member. Full App Attest/Play Integrity binding is a stub for now — just get the shape of this endpoint right.

## Task 3 — Admin capabilities (minimal, API-level only, no UI needed yet)
- List pending/active/suspended members
- Revoke a device (sets `revoked_at`, `allow_listed = false`)
- Suspend/remove a member
- All admin endpoints require role = admin and proper auth — write basic middleware for this now since every future phase depends on it

## Task 4 — Encryption groundwork (prep only, not full implementation)
- Add a `public_key` field to `devices` (for future Signal Protocol identity keys)
- Don't implement full Signal Protocol session management yet — just make sure the schema has a place for it, so Phase 2 isn't a schema migration nightmare
- Document in a `NOTES.md` file where libsignal integration will hook in

## Explicit constraints
- No dependency on any Apple App Store services (no App Store Connect API assumptions)
- No public/open registration endpoint — enrollment must always originate from an admin-created invite
- Store OTP codes hashed, never plaintext
- All timestamps in UTC
- Write basic automated tests for the enrollment flow (happy path + expired token + expired OTP + rate limit)

## Deliverable for this phase
A running backend (Replit-hosted) where I can, using a REST client (Postman/curl), walk through: admin creates invite → invitee verifies invite → requests OTP → verifies OTP → member record created → device registered. Provide a short `README.md` with example curl commands for the full flow.

## Explicitly out of scope this phase
- Chat/messaging functionality
- Meeting summary / action items
- Any native mobile code
- Watermarking, screenshot detection, FLAG_SECURE, App Attest real implementation
- Frontend/UI of any kind
