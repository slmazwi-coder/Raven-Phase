import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  enrollmentInvitesTable,
  membersTable,
  devicesTable,
  groupsTable,
  groupMembersTable,
} from "@workspace/db";
import { generateInviteToken, inviteExpiresAt } from "../lib/otp";
import { requireAuth } from "../middleware/requireAuth";
import { requireAdmin } from "../middleware/requireAdmin";

const router: IRouter = Router();

// Apply auth + admin check to all /admin routes
router.use("/admin", requireAuth, requireAdmin);

// POST /api/admin/invites
// Create an enrollment invite for a cell number
router.post("/admin/invites", async (req, res): Promise<void> => {
  const { cell_number: cellNumber } = req.body as { cell_number?: string };
  if (!cellNumber || typeof cellNumber !== "string") {
    res.status(400).json({ error: "cell_number is required (E.164 format)" });
    return;
  }

  const adminId = req.auth!.sub;

  const token = generateInviteToken();
  const expiresAt = inviteExpiresAt();

  const [invite] = await db
    .insert(enrollmentInvitesTable)
    .values({
      cellNumber,
      invitedBy: adminId,
      token,
      expiresAt,
    })
    .returning();

  res.status(201).json({
    invite: {
      id: invite.id,
      cellNumber: invite.cellNumber,
      token: invite.token,
      expiresAt: invite.expiresAt,
    },
    enrollmentLink: `/enroll?token=${token}`,
  });
});

// GET /api/admin/members
// List members, optionally filtered by status
router.get("/admin/members", async (req, res): Promise<void> => {
  const { status } = req.query as { status?: string };

  const validStatuses = ["pending", "active", "suspended", "removed"] as const;
  type MemberStatus = (typeof validStatuses)[number];

  let rows;
  if (status && validStatuses.includes(status as MemberStatus)) {
    rows = await db
      .select()
      .from(membersTable)
      .where(eq(membersTable.status, status as MemberStatus))
      .orderBy(desc(membersTable.createdAt));
  } else {
    rows = await db
      .select()
      .from(membersTable)
      .orderBy(desc(membersTable.createdAt));
  }

  res.json({ members: rows });
});

// POST /api/admin/members/:id/suspend
router.post("/admin/members/:id/suspend", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [updated] = await db
    .update(membersTable)
    .set({ status: "suspended", updatedAt: new Date() })
    .where(
      and(
        eq(membersTable.id, raw),
        inArray(membersTable.status, ["active", "pending"]),
      ),
    )
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Member not found or already suspended/removed" });
    return;
  }

  res.json({ ok: true, member: updated });
});

// POST /api/admin/members/:id/remove
router.post("/admin/members/:id/remove", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [updated] = await db
    .update(membersTable)
    .set({ status: "removed", updatedAt: new Date() })
    .where(eq(membersTable.id, raw))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  // Also revoke all devices for this member
  await db
    .update(devicesTable)
    .set({ revokedAt: new Date(), allowListed: false })
    .where(
      and(eq(devicesTable.memberId, raw), isNull(devicesTable.revokedAt)),
    );

  res.json({ ok: true, member: updated });
});

// POST /api/admin/devices/:id/revoke
router.post("/admin/devices/:id/revoke", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [updated] = await db
    .update(devicesTable)
    .set({ revokedAt: new Date(), allowListed: false })
    .where(and(eq(devicesTable.id, raw), isNull(devicesTable.revokedAt)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Device not found or already revoked" });
    return;
  }

  res.json({ ok: true, device: updated });
});

// ─── Group management (admin only) ──────────────────────────────────────────

// GET /api/admin/groups
router.get("/admin/groups", async (req, res): Promise<void> => {
  const groups = await db
    .select()
    .from(groupsTable)
    .orderBy(desc(groupsTable.createdAt));
  res.json({ groups });
});

// POST /api/admin/groups — create group, auto-add creator as group admin
router.post("/admin/groups", async (req, res): Promise<void> => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const adminId = req.auth!.sub;

  const [group] = await db
    .insert(groupsTable)
    .values({ name: name.trim(), createdBy: adminId })
    .returning();

  await db.insert(groupMembersTable).values({
    groupId: group.id,
    memberId: adminId,
    roleInGroup: "admin",
  });

  res.status(201).json({ group });
});

// POST /api/admin/groups/:id/members — add a member to a group
router.post(
  "/admin/groups/:id/members",
  async (req, res): Promise<void> => {
    const groupId = req.params.id as string;
    const {
      member_id: memberId,
      role_in_group: roleInGroup = "member",
    } = req.body as { member_id?: string; role_in_group?: string };

    if (!memberId) {
      res.status(400).json({ error: "member_id is required" });
      return;
    }

    const validRoles = ["admin", "moderator", "member"] as const;
    const safeRole = validRoles.includes(
      roleInGroup as (typeof validRoles)[number],
    )
      ? (roleInGroup as (typeof validRoles)[number])
      : "member";

    const [membership] = await db
      .insert(groupMembersTable)
      .values({ groupId, memberId, roleInGroup: safeRole })
      .onConflictDoNothing()
      .returning();

    if (!membership) {
      res.status(409).json({ error: "Member is already in this group" });
      return;
    }

    res.status(201).json({ membership });
  },
);

// DELETE /api/admin/groups/:id/members/:memberId — remove member from group
router.delete(
  "/admin/groups/:id/members/:memberId",
  async (req, res): Promise<void> => {
    const groupId = req.params.id as string;
    const memberId = req.params.memberId as string;

    await db
      .delete(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.groupId, groupId),
          eq(groupMembersTable.memberId, memberId),
        ),
      );

    res.json({ ok: true });
  },
);

export default router;
