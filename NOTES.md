# Raven — Technical Notes

## libsignal Integration Hooks (Phase 2)

This document records where the Signal Protocol integration will attach in Phase 2+.

### Where libsignal connects

#### 1. Device registration — `POST /api/enroll/register-device`

The `public_key` field on the `devices` table is the primary hook.

In Phase 2, the mobile client will:
1. Generate an X3DH identity key pair using `@signalapp/libsignal-client`
2. Send the identity public key (IK_pub, 32 bytes, Curve25519) as `public_key` in the register-device body
3. The server stores it as-is (base64 or hex encoded)

The field is currently nullable — Phase 2 will make it required and validate it as a valid Ed25519/X25519 key.

#### 2. Key bundle endpoint — `GET /api/members/:id/key-bundle` (Phase 2)

For X3DH session establishment, senders need the recipient's:
- Identity key (IK)
- Signed pre-key (SPK)
- One-time pre-keys (OPKs)

Phase 2 will add a `pre_keys` table:
```sql
pre_keys (
  id uuid pk,
  device_id uuid fk → devices,
  key_type  enum(signed, one_time),
  key_id    int,
  public_key text,
  signature text,   -- only for signed pre-keys
  used_at   timestamptz nullable,
  created_at timestamptz
)
```

And a `GET /api/members/:id/key-bundle` endpoint that returns a bundle for session init.

#### 3. Message storage — `messages` table (Phase 2/4)

The `messages` table is currently a stub. In Phase 2/4, it will store only the sealed-sender ciphertext — never plaintext. Schema will include:
- `sender_device_id` — for sealed-sender unblinding
- `recipient_id` — member or group
- `ciphertext` — Signal ciphertext blob
- `message_type` — Signal envelope type (1 = whisper, 3 = pre-key bundle)
- `server_timestamp` — for ordering; clients do not trust this for security

#### 4. Session management

libsignal session state is stored client-side only. The server is a dumb routing layer for ciphertexts — it never holds plaintext or decryption keys.

The server's role post-Phase-2:
- Store and serve pre-key bundles
- Route sealed-sender ciphertext messages
- Handle device revocation (invalidates sessions on clients)

### Relevant libsignal packages

```
@signalapp/libsignal-client   # Node/server-side (if needed for server-side verification)
```

In most deployments the server does NOT import libsignal at all — all crypto runs on the client. The server only needs libsignal if implementing server-side sealed-sender certificate validation.

### Security checklist before Phase 2 merge

- [ ] `public_key` field validated as valid X25519 key (32 bytes)
- [ ] Pre-key bundles served only to authenticated members
- [ ] One-time pre-keys marked used atomically (use DB transaction + SELECT FOR UPDATE)
- [ ] Signed pre-key rotation endpoint added
- [ ] Sealed-sender certificate chain validated
- [ ] Message fanout (for groups) happens server-side with separate per-recipient ciphertexts
