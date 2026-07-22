import { Router, type IRouter } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  groupMembersTable,
  groupsTable,
  membersTable,
  messagesTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/requireAuth";

const router: IRouter = Router();

// All group routes require auth
router.use("/groups", requireAuth);

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
      role: membersTable.role,
      status: membersTable.status,
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
