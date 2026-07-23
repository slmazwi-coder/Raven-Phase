import { Router, type IRouter } from "express";
import { and, count, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  enrollmentInvitesTable,
  otpCodesTable,
  membersTable,
  devicesTable,
} from "@workspace/db";
import {
  generateOtpCode,
  hashOtpCode,
  otpExpiresAt,
} from "../lib/otp";
import { sendOtpSms, twilioConfigured } from "../lib/twilio";
import { signToken } from "../lib/auth";
import { requireAuth } from "../middleware/requireAuth";

const router: IRouter = Router();

const OTP_MAX_ATTEMPTS = 5;
const OTP_RATE_LIMIT = 3; // max per number per hour

const isReplit = !!(
  process.env.REPL_ID ||
  process.env.REPLIT_DOMAINS ||
  process.env.REPLIT_DEV_DOMAIN ||
  process.env.REPLIT_DEPLOYMENT
);

function isDevEnvironment(): boolean {
  if (process.env.RAVEN_DEV_OTP === "true") return true;
  if (process.env.RAVEN_DEV_OTP === "false") return false;

  if (process.env.NODE_ENV === "production") {
    // In Replit, a production NODE_ENV without REPLIT_DEPLOYMENT means a build/preview,
    // not the published app. In non-Replit production, keep dev OTP disabled.
    return isReplit && !process.env.REPLIT_DEPLOYMENT;
  }

  return true;
}

// POST /api/enroll/verify-invite
// Public — check that an invite token is valid and not expired
router.post("/enroll/verify-invite", async (req, res): Promise<void> => {
  const { token } = req.body as { token?: string };
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const [invite] = await db
    .select()
    .from(enrollmentInvitesTable)
    .where(eq(enrollmentInvitesTable.token, token));

  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }
  if (invite.usedAt) {
    res.status(410).json({ error: "This invite has already been used" });
    return;
  }
  if (new Date() > invite.expiresAt) {
    res.status(410).json({ error: "This invite has expired" });
    return;
  }

  res.json({
    valid: true,
    communityName: "Raven",
    cellNumber: invite.cellNumber,
  });
});

// POST /api/enroll/request-otp
// Public — send an OTP to the given cell number (invite-free onboarding)
router.post("/enroll/request-otp", async (req, res): Promise<void> => {
  const { cell_number: cellNumber } = req.body as { cell_number?: string };
  if (!cellNumber || typeof cellNumber !== "string") {
    res.status(400).json({ error: "cell_number is required (E.164 format)" });
    return;
  }

  // Rate limit: max OTP_RATE_LIMIT requests per number per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [{ value: recentCount }] = await db
    .select({ value: count() })
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.cellNumber, cellNumber),
        gt(otpCodesTable.createdAt, oneHourAgo),
      ),
    );

  if (Number(recentCount) >= OTP_RATE_LIMIT) {
    res.status(429).json({
      error: "Too many OTP requests. Please wait before requesting another.",
    });
    return;
  }

  if (!twilioConfigured()) {
    req.log.warn({ cellNumber }, "Twilio not configured — OTP not sent");
  }

  const code = generateOtpCode();
  const codeHash = hashOtpCode(code);
  const expiresAt = otpExpiresAt();

  await db.insert(otpCodesTable).values({
    cellNumber,
    codeHash,
    expiresAt,
    attempts: 0,
  });

  const devMode = isDevEnvironment();

  const smsResult = await sendOtpSms(cellNumber, code);
  if (!smsResult.ok && !devMode) {
    req.log.error({ error: smsResult.error }, "Failed to send OTP SMS");
    res.status(502).json({ error: "Failed to send OTP. Please try again." });
    return;
  }

  if (!smsResult.ok) {
    req.log.warn(
      { error: smsResult.error },
      "SMS send failed or Twilio not configured — returning dev OTP",
    );
  }

  // In non-production environments, surface the OTP for testing when SMS could not be sent
  const devPayload = devMode && !smsResult.ok ? { dev_otp: code } : {};

  res.json({ ok: true, message: "OTP sent", ...devPayload });
});

// POST /api/enroll/verify-otp
// Public — verify the OTP and issue an auth token
router.post("/enroll/verify-otp", async (req, res): Promise<void> => {
  const { cell_number: cellNumber, code, full_name: fullName } = req.body as {
    cell_number?: string;
    code?: string;
    full_name?: string;
  };
  if (!cellNumber || !code) {
    res.status(400).json({ error: "cell_number and code are required" });
    return;
  }

  // Find the most recent active OTP for this number
  const [otpRecord] = await db
    .select()
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.cellNumber, cellNumber),
        isNull(otpCodesTable.verifiedAt),
      ),
    )
    .orderBy(sql`${otpCodesTable.createdAt} DESC`)
    .limit(1);

  if (!otpRecord) {
    res.status(400).json({ error: "No pending OTP for this number" });
    return;
  }

  if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
    res.status(429).json({
      error: "Too many failed attempts. Please request a new OTP.",
    });
    return;
  }

  if (new Date() > otpRecord.expiresAt) {
    res.status(410).json({ error: "OTP has expired. Please request a new one." });
    return;
  }

  const inputHash = hashOtpCode(code);
  if (inputHash !== otpRecord.codeHash) {
    // Increment attempt counter
    await db
      .update(otpCodesTable)
      .set({ attempts: otpRecord.attempts + 1 })
      .where(eq(otpCodesTable.id, otpRecord.id));

    const remaining = OTP_MAX_ATTEMPTS - (otpRecord.attempts + 1);
    res.status(400).json({
      error: "Incorrect code",
      attemptsRemaining: Math.max(0, remaining),
    });
    return;
  }

  // Mark OTP as verified
  await db
    .update(otpCodesTable)
    .set({ verifiedAt: new Date() })
    .where(eq(otpCodesTable.id, otpRecord.id));

  // Check if member already exists (re-enrollment guard)
  const [existingMember] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.cellNumber, cellNumber));

  const displayName =
    typeof fullName === "string" && fullName.trim() ? fullName.trim() : cellNumber;

  const member =
    existingMember ??
    (
      await db
        .insert(membersTable)
        .values({
          fullName: displayName,
          cellNumber,
          role: "member",
          status: "active",
        })
        .returning()
    )[0];

  const token = signToken({ sub: member.id, role: member.role });

  res.json({
    ok: true,
    token,
    member: {
      id: member.id,
      cellNumber: member.cellNumber,
      role: member.role,
      status: member.status,
    },
  });
});

// POST /api/enroll/register-device
// Requires the auth token issued by verify-otp
router.post(
  "/enroll/register-device",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      platform,
      device_identifier: deviceIdentifier,
      public_key: publicKey,
      attestation: bodyAttestation,
    } = req.body as {
      platform?: string;
      device_identifier?: string;
      public_key?: string;
      attestation?: string;
    };

    // The attestation middleware validates the X-Raven-Attestation header;
    // fall back to an explicit body field if the route is called directly.
    const headerAttestation = req.headers["x-raven-attestation"];
    const attestation =
      typeof headerAttestation === "string" ? headerAttestation : (bodyAttestation ?? null);

    if (!platform || !deviceIdentifier) {
      res.status(400).json({ error: "platform and device_identifier are required" });
      return;
    }
    if (platform !== "ios" && platform !== "android") {
      res.status(400).json({ error: "platform must be 'ios' or 'android'" });
      return;
    }

    const memberId = req.auth!.sub;

    const [device] = await db
      .insert(devicesTable)
      .values({
        memberId,
        platform: platform as "ios" | "android",
        deviceIdentifier,
        attestation: attestation ?? null,
        publicKey: publicKey ?? null,
        allowListed: true,
      })
      .returning();

    res.status(201).json({ ok: true, device });
  },
);

export default router;
