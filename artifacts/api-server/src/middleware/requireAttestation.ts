import type { Request, Response, NextFunction } from "express";

// Exempted public/unauthenticated routes that cannot yet provide an attestation token.
const EXEMPT_PATHS = [
  "/api/healthz",
  "/api/enroll/verify-invite",
  "/api/enroll/request-otp",
  "/api/enroll/verify-otp",
];

const isReplit = !!(
  process.env.REPL_ID ||
  process.env.REPLIT_DOMAINS ||
  process.env.REPLIT_DEV_DOMAIN ||
  process.env.REPLIT_DEPLOYMENT
);

function isDevEnvironment(): boolean {
  if (process.env.RAVEN_SKIP_ATTESTATION === "true") return true;
  if (process.env.RAVEN_SKIP_ATTESTATION === "false") return false;
  if (process.env.NODE_ENV !== "production") return true;
  // Replit preview builds set NODE_ENV=production but not REPLIT_DEPLOYMENT
  return isReplit && !process.env.REPLIT_DEPLOYMENT;
}

declare global {
  namespace Express {
    interface Request {
      /** Parsed attestation payload from the X-Raven-Attestation header. */
      attestation?: unknown;
    }
  }
}

/**
 * Require a non-empty, parseable X-Raven-Attestation header.
 *
 * This is intentionally a lightweight check: verifying an App Attest blob or
 * Play Integrity token against Apple/Google requires server-side credentials
 * and is left as a follow-up integration step. For now we reject missing or
 * malformed headers and surface the raw payload to downstream handlers.
 */
export function requireAttestation(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (EXEMPT_PATHS.some((p) => req.path === p)) {
    next();
    return;
  }

  // Dev/testing override for simulators, emulators, and web previews where
  // App Attest / Play Integrity cannot produce a valid token.
  if (isDevEnvironment()) {
    next();
    return;
  }

  const raw = req.headers["x-raven-attestation"];
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    res.status(403).json({ error: "Missing attestation token" });
    return;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Attestation payload must be an object");
    }
    req.attestation = parsed;
    next();
  } catch {
    res.status(403).json({ error: "Invalid attestation token" });
  }
}
