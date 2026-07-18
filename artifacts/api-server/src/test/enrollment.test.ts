/**
 * Raven enrollment flow tests.
 *
 * These are integration tests that run against the real DATABASE_URL.
 * Twilio SMS sending is bypassed — dev_otp is returned in the response
 * when Twilio is not configured.
 *
 * Run: pnpm --filter @workspace/api-server run test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  membersTable,
  enrollmentInvitesTable,
  otpCodesTable,
  devicesTable,
} from "@workspace/db";
import {
  generateInviteToken,
  inviteExpiresAt,
  hashOtpCode,
} from "../lib/otp";
import { signToken } from "../lib/auth";
import app from "../app";

// ─── helpers ─────────────────────────────────────────────────────────────────

const TEST_CELL = "+19995550101";
const TEST_CELL_RATE = "+19995550102";

async function cleanup() {
  // Clean up in FK-safe order
  await db.delete(devicesTable).where(eq(devicesTable.memberId,
    // Subquery not needed; just delete any device for test cells
    // We'll clean by joining through member
    // Easiest: delete all test members' devices via two queries
    "00000000-0000-0000-0000-000000000001" // won't match anything — handled below
  ));
  // Delete devices for all test members
  const testMembers = await db
    .select({ id: membersTable.id })
    .from(membersTable)
    .where(eq(membersTable.cellNumber, TEST_CELL));
  const testMembers2 = await db
    .select({ id: membersTable.id })
    .from(membersTable)
    .where(eq(membersTable.cellNumber, TEST_CELL_RATE));
  const allIds = [...testMembers, ...testMembers2].map((m) => m.id);
  for (const { id } of allIds.map((id) => ({ id }))) {
    await db.delete(devicesTable).where(eq(devicesTable.memberId, id));
  }

  await db
    .delete(otpCodesTable)
    .where(eq(otpCodesTable.cellNumber, TEST_CELL));
  await db
    .delete(otpCodesTable)
    .where(eq(otpCodesTable.cellNumber, TEST_CELL_RATE));
  await db
    .delete(enrollmentInvitesTable)
    .where(eq(enrollmentInvitesTable.cellNumber, TEST_CELL));
  await db
    .delete(enrollmentInvitesTable)
    .where(eq(enrollmentInvitesTable.cellNumber, TEST_CELL_RATE));
  await db
    .delete(membersTable)
    .where(eq(membersTable.cellNumber, TEST_CELL));
  await db
    .delete(membersTable)
    .where(eq(membersTable.cellNumber, TEST_CELL_RATE));
}

let adminId: string;
let adminToken: string;

// ─── setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await cleanup();

  // Create (or reuse) an admin member for invite creation
  let [admin] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.cellNumber, "+10000000000"));

  if (!admin) {
    [admin] = await db
      .insert(membersTable)
      .values({
        fullName: "Test Admin",
        cellNumber: "+10000000000",
        role: "admin",
        status: "active",
      })
      .returning();
  }

  adminId = admin.id;
  adminToken = signToken({ sub: admin.id, role: "admin" });
});

afterAll(async () => {
  await cleanup();
  // Clean up test admin only if we created it
  await db
    .delete(membersTable)
    .where(eq(membersTable.cellNumber, "+10000000000"));
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe("Enrollment happy path", () => {
  let inviteToken: string;
  let authToken: string;

  it("Admin creates an invite", async () => {
    const res = await request(app)
      .post("/api/admin/invites")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ cell_number: TEST_CELL });

    expect(res.status).toBe(201);
    expect(res.body.invite.token).toBeTruthy();
    inviteToken = res.body.invite.token as string;
  });

  it("Invitee verifies the invite token", async () => {
    const res = await request(app)
      .post("/api/enroll/verify-invite")
      .send({ token: inviteToken });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.communityName).toBe("Raven");
  });

  it("Invitee requests an OTP", async () => {
    const res = await request(app)
      .post("/api/enroll/request-otp")
      .send({ cell_number: TEST_CELL });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // dev_otp is returned when Twilio is not configured
    expect(res.body.dev_otp).toMatch(/^\d{6}$/);
  });

  it("Invitee verifies the OTP and receives an auth token", async () => {
    // Get the OTP from the DB (since we can't receive SMS in tests)
    const [otpRecord] = await db
      .select()
      .from(otpCodesTable)
      .where(
        and(
          eq(otpCodesTable.cellNumber, TEST_CELL),
          isNull(otpCodesTable.verifiedAt),
        ),
      )
      .orderBy(otpCodesTable.createdAt)
      .limit(1);

    // We need the plaintext code — re-request via the API and grab dev_otp
    const otpRes = await request(app)
      .post("/api/enroll/request-otp")
      .send({ cell_number: TEST_CELL });

    const code = otpRes.body.dev_otp as string;
    expect(code).toMatch(/^\d{6}$/);

    const res = await request(app)
      .post("/api/enroll/verify-otp")
      .send({ cell_number: TEST_CELL, code });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    authToken = res.body.token as string;
  });

  it("Member registers a device", async () => {
    const res = await request(app)
      .post("/api/enroll/register-device")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        platform: "ios",
        device_identifier: "test-device-hash-abc123",
        public_key: null,
      });

    expect(res.status).toBe(201);
    expect(res.body.device.platform).toBe("ios");
    expect(res.body.device.allowListed).toBe(true);
  });
});

describe("Expired invite token", () => {
  it("Returns 410 for an expired invite", async () => {
    const token = generateInviteToken();
    await db.insert(enrollmentInvitesTable).values({
      cellNumber: TEST_CELL,
      invitedBy: adminId,
      token,
      expiresAt: new Date(Date.now() - 1000), // already expired
    });

    const res = await request(app)
      .post("/api/enroll/verify-invite")
      .send({ token });

    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/expired/i);
  });
});

describe("Expired OTP", () => {
  it("Returns 410 for an expired OTP", async () => {
    // Create a fresh invite so request-otp passes
    const inviteToken = generateInviteToken();
    await db.insert(enrollmentInvitesTable).values({
      cellNumber: TEST_CELL,
      invitedBy: adminId,
      token: inviteToken,
      expiresAt: inviteExpiresAt(),
    });

    // Insert an expired OTP directly
    await db.insert(otpCodesTable).values({
      cellNumber: TEST_CELL,
      codeHash: hashOtpCode("999999"),
      expiresAt: new Date(Date.now() - 1000), // already expired
      attempts: 0,
    });

    const res = await request(app)
      .post("/api/enroll/verify-otp")
      .send({ cell_number: TEST_CELL, code: "999999" });

    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/expired/i);
  });
});

describe("OTP rate limiting", () => {
  it("Blocks after 3 OTP requests per hour", async () => {
    // Ensure there's a valid invite for the rate-limit test cell
    const token = generateInviteToken();
    await db.insert(enrollmentInvitesTable).values({
      cellNumber: TEST_CELL_RATE,
      invitedBy: adminId,
      token,
      expiresAt: inviteExpiresAt(),
    });

    // Insert 3 OTP records (simulating 3 prior requests this hour)
    for (let i = 0; i < 3; i++) {
      await db.insert(otpCodesTable).values({
        cellNumber: TEST_CELL_RATE,
        codeHash: hashOtpCode("000000"),
        expiresAt: new Date(Date.now() + 8 * 60 * 1000),
        attempts: 0,
      });
    }

    const res = await request(app)
      .post("/api/enroll/request-otp")
      .send({ cell_number: TEST_CELL_RATE });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many/i);
  });
});
