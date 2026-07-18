# Raven — Phase 1 Backend

Privacy-focused, invite-only chat backend for ~150 members. This phase delivers the enrollment foundation: admin-controlled invites, OTP-based phone verification, member and device registration.

## Stack

- **Runtime**: Node.js 24 + TypeScript (ESM)
- **Database**: PostgreSQL via Drizzle ORM
- **Auth**: JWT (signed with `SESSION_SECRET`)
- **SMS**: Twilio REST API (fetch-based, no SDK)
- **Rate limiting**: DB-based (otp_codes table)
- **Real-time**: reserved for Phase 2

## Required Environment Variables / Secrets

| Key | How to set | Notes |
|---|---|---|
| `DATABASE_URL` | Auto-managed by Replit | Postgres connection |
| `SESSION_SECRET` | Replit Secret | JWT signing key |
| `TWILIO_ACCOUNT_SID` | Replit Secret | SMS delivery |
| `TWILIO_AUTH_TOKEN` | Replit Secret | SMS delivery |
| `TWILIO_PHONE_NUMBER` | Replit Secret | E.164 sender number |

> **Dev mode**: If Twilio is not configured, OTPs are returned in the response body as `dev_otp` instead of being sent via SMS. This is blocked in production.

## Seeding the first admin

There is no public signup. Seed the first admin directly:

```bash
# Get a psql shell via Replit's DB tool, then:
INSERT INTO members (id, full_name, cell_number, role, status)
VALUES (gen_random_uuid(), 'Alice Admin', '+1XXXXXXXXXX', 'admin', 'active');
```

Then sign a token for them (run once in a Node.js REPL or script):

```js
import jwt from 'jsonwebtoken';
const token = jwt.sign(
  { sub: '<member-uuid>', role: 'admin' },
  process.env.SESSION_SECRET,
  { expiresIn: '30d' }
);
console.log(token);
```

## Full enrollment flow (curl)

Replace `<BASE>` with your Replit dev URL (e.g. `https://<repl>.replit.dev`).

### Step 1 — Admin creates an invite

```bash
ADMIN_TOKEN="<jwt-from-seed-step>"

curl -s -X POST $BASE/api/admin/invites \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cell_number": "+14155550100"}' | jq .
```

Response:
```json
{
  "invite": {
    "id": "...",
    "cellNumber": "+14155550100",
    "token": "abc123...",
    "expiresAt": "2026-07-20T..."
  },
  "enrollmentLink": "/enroll?token=abc123..."
}
```

### Step 2 — Invitee verifies the invite token

```bash
INVITE_TOKEN="abc123..."

curl -s -X POST $BASE/api/enroll/verify-invite \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$INVITE_TOKEN\"}" | jq .
```

Response:
```json
{ "valid": true, "communityName": "Raven", "cellNumber": "+14155550100" }
```

### Step 3 — Invitee requests an OTP

```bash
curl -s -X POST $BASE/api/enroll/request-otp \
  -H "Content-Type: application/json" \
  -d '{"cell_number": "+14155550100"}' | jq .
```

Response (production — Twilio configured):
```json
{ "ok": true, "message": "OTP sent" }
```

Response (dev — Twilio not configured):
```json
{ "ok": true, "message": "OTP sent", "dev_otp": "482910" }
```

### Step 4 — Invitee verifies the OTP

```bash
OTP_CODE="482910"

curl -s -X POST $BASE/api/enroll/verify-otp \
  -H "Content-Type: application/json" \
  -d "{\"cell_number\": \"+14155550100\", \"code\": \"$OTP_CODE\"}" | jq .
```

Response:
```json
{
  "ok": true,
  "token": "<jwt>",
  "member": {
    "id": "...",
    "cellNumber": "+14155550100",
    "role": "member",
    "status": "active"
  }
}
```

### Step 5 — Mobile client registers the device

```bash
MEMBER_TOKEN="<jwt-from-step-4>"

curl -s -X POST $BASE/api/enroll/register-device \
  -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "ios",
    "device_identifier": "PLACEHOLDER_ATTEST_HASH",
    "public_key": null
  }' | jq .
```

Response:
```json
{
  "ok": true,
  "device": {
    "id": "...",
    "memberId": "...",
    "platform": "ios",
    "deviceIdentifier": "PLACEHOLDER_ATTEST_HASH",
    "publicKey": null,
    "allowListed": true,
    "registeredAt": "..."
  }
}
```

## Admin API

All admin endpoints require `Authorization: Bearer <admin-jwt>`.

```bash
# List all members
curl -s $BASE/api/admin/members \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .

# Filter by status (pending | active | suspended | removed)
curl -s "$BASE/api/admin/members?status=active" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .

# Suspend a member
curl -s -X POST $BASE/api/admin/members/<member-id>/suspend \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .

# Remove a member (also revokes all devices)
curl -s -X POST $BASE/api/admin/members/<member-id>/remove \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .

# Revoke a device
curl -s -X POST $BASE/api/admin/devices/<device-id>/revoke \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
```

## Running tests

```bash
pnpm --filter @workspace/api-server run test
```

Tests cover:
- Happy path: invite → verify → OTP → verify → register device
- Expired invite token (410)
- Expired OTP (410)
- OTP rate limit — 3 per number per hour (429)

## DB commands

```bash
# Push schema changes
pnpm --filter @workspace/db run push

# Full typecheck
pnpm run typecheck
```
