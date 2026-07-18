# Raven

Privacy-focused, invite-only chat backend for a closed community of ~150 people. Phase 1 delivers the enrollment foundation — admin-controlled invites, OTP-based phone verification, member and device registration.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run test` — run enrollment flow integration tests

## Required Secrets

| Secret | Purpose |
|---|---|
| `SESSION_SECRET` | JWT signing key |
| `TWILIO_ACCOUNT_SID` | Twilio SMS — OTP delivery |
| `TWILIO_AUTH_TOKEN` | Twilio SMS — OTP delivery |
| `TWILIO_PHONE_NUMBER` | Twilio sender number (E.164) |

`DATABASE_URL` is auto-managed by Replit.

**Dev mode:** If Twilio secrets are absent, OTPs are returned as `dev_otp` in the API response instead of being sent via SMS.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Auth: JWT (`jsonwebtoken`, signed with `SESSION_SECRET`)
- SMS: Twilio REST API (fetch-based, no SDK)
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)
- Tests: Vitest + Supertest

## Where things live

- `lib/db/src/schema/` — all Drizzle table definitions (members, devices, enrollment_invites, otp_codes, groups, messages stub, action_items stub)
- `artifacts/api-server/src/routes/enroll.ts` — enrollment flow endpoints
- `artifacts/api-server/src/routes/admin.ts` — admin endpoints
- `artifacts/api-server/src/lib/auth.ts` — JWT sign/verify
- `artifacts/api-server/src/lib/otp.ts` — OTP generation and hashing
- `artifacts/api-server/src/lib/twilio.ts` — Twilio SMS helper
- `artifacts/api-server/src/middleware/` — requireAuth, requireAdmin
- `artifacts/api-server/src/test/enrollment.test.ts` — integration tests
- `README.md` — curl examples for the full enrollment flow
- `NOTES.md` — libsignal integration hooks for Phase 2

## Architecture decisions

- **No public signup** — all enrollment originates from an admin-created invite token; no endpoint accepts self-registration
- **OTPs hashed with SHA-256** — plaintext codes are never persisted; only the hash is stored
- **JWT for auth** — stateless sessions signed with `SESSION_SECRET`; no Redis required in Phase 1
- **DB-based rate limiting** — OTP request rate limit (3/hour) queries `otp_codes` table directly; avoids Redis dependency in Phase 1
- **Twilio via fetch** — calls Twilio REST API directly without the SDK to keep the bundle lean and avoid bundling issues
- **publicKey on devices is nullable** — placeholder for Signal Protocol X3DH identity key; Phase 2 will enforce non-null with key validation
- **messages and action_items are stub tables** — minimal schema placeholders to make Phase 2 migrations additive, not breaking

## Product

**Enrollment flow**: Admin creates invite → invitee verifies token → requests SMS OTP → verifies OTP → member record created → device registered.

**Admin API**: List/filter members by status, suspend/remove members, revoke individual devices.

All admin endpoints require `role = admin` on the JWT.

## User preferences

_Populate as you build._

## Gotchas

- Always run `pnpm --filter @workspace/db run push` after schema changes before restarting the workflow
- Run `pnpm run typecheck:libs` before leaf package typechecks when changing `lib/*` packages
- Seeding the first admin requires a direct DB insert — see `README.md` for the exact SQL
- `TWILIO_PHONE_NUMBER` must be in E.164 format (e.g. `+12025550100`)

## Pointers

- See `NOTES.md` for where libsignal hooks into Phase 2
- See `README.md` for full curl examples and the first-admin seed procedure
- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
