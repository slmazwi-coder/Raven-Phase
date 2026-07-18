import crypto from "node:crypto";

const OTP_TTL_MS = 8 * 60 * 1000; // 8 minutes
const OTP_DIGITS = 6;

/** Generate a random numeric OTP code */
export function generateOtpCode(): string {
  const max = Math.pow(10, OTP_DIGITS);
  const n = crypto.randomInt(0, max);
  return n.toString().padStart(OTP_DIGITS, "0");
}

/** SHA-256 hash of the code — never store plaintext OTP */
export function hashOtpCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/** OTP expiry date: now + OTP_TTL_MS, UTC */
export function otpExpiresAt(): Date {
  return new Date(Date.now() + OTP_TTL_MS);
}

/** Generate a cryptographically random invite token (64 hex chars = 32 bytes) */
export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Invite expiry date: now + 48 hours, UTC */
export function inviteExpiresAt(): Date {
  return new Date(Date.now() + 48 * 60 * 60 * 1000);
}
