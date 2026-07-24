import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  groupMembersTable,
  groupsTable,
  membersTable,
  messagesTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/requireAuth";

const router: IRouter = Router();

// All group/member routes require auth
router.use("/groups", requireAuth);
router.use("/members", requireAuth);

// GET /api/groups — list groups the authenticated member belongs to
router.get("/groups", async (req, res): Promise<void> => {
  const memberId = req.auth!.sub;

  const rows = await db
    .select({
      id: groupsTable.id,
      name: groupsTable.name,
      createdAt: groupsTable.createdAt,
      roleInGroup: groupMembersTable.roleInGroup,
      joinedAt: groupMembersTable.joinedAt,
    })
    .from(groupMembersTable)
    .innerJoin(groupsTable, eq(groupMembersTable.groupId, groupsTable.id))
    .where(eq(groupMembersTable.memberId, memberId))
    .orderBy(asc(groupsTable.name));

  res.json({ groups: rows });
});

// POST /api/groups — any authenticated member can create a group
// Body: { name: string, member_ids?: string[] }
router.post("/groups", async (req, res): Promise<void> => {
  const { name, member_ids: memberIds } = req.body as {
    name?: string;
    member_ids?: string[];
  };
  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const creatorId = req.auth!.sub;
  const safeIds = Array.isArray(memberIds)
    ? memberIds.filter((id) => typeof id === "string" && id !== creatorId)
    : [];

  // Only add members that actually exist
  const existingMembers =
    safeIds.length > 0
      ? await db
          .select({ id: membersTable.id })
          .from(membersTable)
          .where(inArray(membersTable.id, safeIds))
      : [];
  const existingIds = existingMembers.map((m) => m.id);

  const [group] = await db
    .insert(groupsTable)
    .values({ name: name.trim(), createdBy: creatorId })
    .returning();

  // Creator is the group admin
  await db.insert(groupMembersTable).values({
    groupId: group.id,
    memberId: creatorId,
    roleInGroup: "admin",
  });

  // Add selected members
  if (existingIds.length > 0) {
    await db.insert(groupMembersTable).values(
      existingIds.map((memberId) => ({
        groupId: group.id,
        memberId,
        roleInGroup: "member" as const,
      })),
    );
  }

  res.status(201).json({ group });
});

// POST /api/groups/:id/members — add a member to a group
// Only group admins can add members
router.post("/groups/:id/members", async (req, res): Promise<void> => {
  const groupId = req.params.id as string;
  const callerId = req.auth!.sub;
  const { member_id: memberId, role_in_group: roleInGroup = "member" } =
    req.body as { member_id?: string; role_in_group?: string };

  if (!memberId) {
    res.status(400).json({ error: "member_id is required" });
    return;
  }

  const [callerMembership] = await db
    .select({ roleInGroup: groupMembersTable.roleInGroup })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.memberId, callerId),
      ),
    );

  if (!callerMembership || callerMembership.roleInGroup !== "admin") {
    res.status(403).json({ error: "Only group admins can add members" });
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
});

// GET /api/members/me — current authenticated member
router.get("/members/me", async (req, res): Promise<void> => {
  const memberId = req.auth!.sub;

  const [member] = await db
    .select({
      id: membersTable.id,
      fullName: membersTable.fullName,
      cellNumber: membersTable.cellNumber,
      avatar: membersTable.avatar,
      role: membersTable.role,
      status: membersTable.status,
      lastSeenAt: membersTable.lastSeenAt,
      createdAt: membersTable.createdAt,
    })
    .from(membersTable)
    .where(eq(membersTable.id, memberId));

  if (!member) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  res.json({ member });
});

// PATCH /api/members/me — update own profile (name/avatar)
router.patch("/members/me", async (req, res): Promise<void> => {
  const memberId = req.auth!.sub;
  const { full_name: fullName, avatar } = req.body as {
    full_name?: string;
    avatar?: string;
  };

  const updates: Partial<{
    fullName: string;
    avatar: string | null;
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  if (fullName !== undefined) {
    const trimmed = fullName.trim();
    if (!trimmed) {
      res.status(400).json({ error: "full_name cannot be empty" });
      return;
    }
    updates.fullName = trimmed;
  }

  if (avatar !== undefined) {
    updates.avatar = avatar.trim() || null;
  }

  const [updated] = await db
    .update(membersTable)
    .set(updates)
    .where(eq(membersTable.id, memberId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  res.json({ member: updated });
});

// GET /api/members/search — search members by name or cell number
router.get("/members/search", async (req, res): Promise<void> => {
  const { q } = req.query as { q?: string };
  const callerId = req.auth!.sub;

  if (!q || q.trim().length < 3) {
    res.status(400).json({ error: "Search query must be at least 3 characters" });
    return;
  }

  const term = `%${q.trim()}%`;
  const rows = await db
    .select({
      id: membersTable.id,
      fullName: membersTable.fullName,
      cellNumber: membersTable.cellNumber,
      avatar: membersTable.avatar,
      lastSeenAt: membersTable.lastSeenAt,
    })
    .from(membersTable)
    .where(
      and(
        or(
          ilike(membersTable.fullName, term),
          ilike(membersTable.cellNumber, term),
        ),
        eq(membersTable.status, "active"),
      ),
    )
    .orderBy(asc(membersTable.fullName))
    .limit(20);

  res.json({
    members: rows
      .filter((m) => m.id !== callerId)
      .map((m) => ({ ...m, cellNumber: m.cellNumber })),
  });
});

// GET /api/groups/:id — group detail + caller's role
router.get("/groups/:id", async (req, res): Promise<void> => {
  const memberId = req.auth!.sub;
  const groupId = req.params.id as string;

  const [membership] = await db
    .select({
      id: groupsTable.id,
      name: groupsTable.name,
      createdAt: groupsTable.createdAt,
      roleInGroup: groupMembersTable.roleInGroup,
    })
    .from(groupMembersTable)
    .innerJoin(groupsTable, eq(groupMembersTable.groupId, groupsTable.id))
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.memberId, memberId),
      ),
    );

  if (!membership) {
    res.status(404).json({ error: "Group not found or you are not a member" });
    return;
  }

  res.json({ group: membership });
});

// GET /api/groups/:id/members — list group members
// Admins see cell numbers; regular members see name only
router.get("/groups/:id/members", async (req, res): Promise<void> => {
  const callerMemberId = req.auth!.sub;
  const callerRole = req.auth!.role;
  const groupId = req.params.id as string;

  // Verify caller is in this group
  const [callerMembership] = await db
    .select({ roleInGroup: groupMembersTable.roleInGroup })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.memberId, callerMemberId),
      ),
    );

  if (!callerMembership) {
    res.status(404).json({ error: "Group not found or you are not a member" });
    return;
  }

  const isAdmin = callerRole === "admin";

  const rows = await db
    .select({
      id: membersTable.id,
      fullName: membersTable.fullName,
      // Always select and strip below for non-admins
      cellNumber: membersTable.cellNumber,
      avatar: membersTable.avatar,
      role: membersTable.role,
      status: membersTable.status,
      lastSeenAt: membersTable.lastSeenAt,
      roleInGroup: groupMembersTable.roleInGroup,
      joinedAt: groupMembersTable.joinedAt,
    })
    .from(groupMembersTable)
    .innerJoin(membersTable, eq(groupMembersTable.memberId, membersTable.id))
    .where(eq(groupMembersTable.groupId, groupId))
    .orderBy(asc(membersTable.fullName));

  // Strip undefined cellNumber for non-admins cleanly
  const members = rows.map((r) => {
    const { cellNumber, ...rest } = r;
    return isAdmin ? { ...rest, cellNumber } : rest;
  });

  res.json({ members });
});

// GET /api/groups/:id/messages — paginated message history
router.get("/groups/:id/messages", async (req, res): Promise<void> => {
  const callerMemberId = req.auth!.sub;
  const groupId = req.params.id as string;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const before = req.query.before as string | undefined; // ISO timestamp cursor

  // Verify caller is in group
  const [membership] = await db
    .select({ roleInGroup: groupMembersTable.roleInGroup })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.memberId, callerMemberId),
      ),
    );

  if (!membership) {
    res.status(404).json({ error: "Group not found or you are not a member" });
    return;
  }

  const { lt, and: _and } = await import("drizzle-orm");

  const whereClause = before
    ? _and(
        eq(messagesTable.groupId, groupId),
        lt(messagesTable.createdAt, new Date(before)),
      )
    : eq(messagesTable.groupId, groupId);

  const messages = await db
    .select({
      id: messagesTable.id,
      groupId: messagesTable.groupId,
      senderId: messagesTable.senderId,
      senderName: membersTable.fullName,
      senderAvatar: membersTable.avatar,
      content: messagesTable.content,
      contentType: messagesTable.contentType,
      deliveredAt: messagesTable.deliveredAt,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .innerJoin(membersTable, eq(messagesTable.senderId, membersTable.id))
    .where(whereClause)
    .orderBy(desc(messagesTable.createdAt))
    .limit(limit);

  res.json({ messages: messages.reverse(), hasMore: messages.length === limit });
});

export default router;
