import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  groupMembersTable,
  groupsTable,
  membersTable,
  messageReadsTable,
  messagesTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/requireAuth";
import { logger } from "../lib/logger";
import { getGroupMemberIds } from "../lib/ws-broadcast";

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
      isDirect: groupsTable.isDirect,
      readReceiptsEnabled: groupsTable.readReceiptsEnabled,
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

async function findDirectGroup(
  memberA: string,
  memberB: string,
): Promise<{ id: string; name: string } | null> {
  // Find an is_direct group that contains exactly these two members
  const candidateGroups = db
    .select({ groupId: groupMembersTable.groupId })
    .from(groupMembersTable)
    .where(inArray(groupMembersTable.memberId, [memberA, memberB]))
    .groupBy(groupMembersTable.groupId)
    .having(sql`count(distinct ${groupMembersTable.memberId}) = 2 and count(*) = 2`)
    .as("candidate_groups");

  const rows = await db
    .select({ id: groupsTable.id, name: groupsTable.name })
    .from(groupsTable)
    .innerJoin(candidateGroups, eq(groupsTable.id, candidateGroups.groupId))
    .where(eq(groupsTable.isDirect, true));

  return rows[0] ?? null;
}

// POST /api/groups/direct — start or open a DM with another member
// Body: { member_id: string, name?: string }
router.post("/groups/direct", async (req, res): Promise<void> => {
  const callerId = req.auth!.sub;
  const { member_id: otherId, name } = req.body as {
    member_id?: string;
    name?: string;
  };

  if (!otherId) {
    res.status(400).json({ error: "member_id is required" });
    return;
  }

  if (otherId === callerId) {
    res.status(400).json({ error: "Cannot start a DM with yourself" });
    return;
  }

  const [other] = await db
    .select({ id: membersTable.id, fullName: membersTable.fullName })
    .from(membersTable)
    .where(eq(membersTable.id, otherId));

  if (!other) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  const existing = await findDirectGroup(callerId, otherId);
  if (existing) {
    res.json({ group: existing });
    return;
  }

  const groupName = name?.trim() || other.fullName || "Direct message";

  const [group] = await db
    .insert(groupsTable)
    .values({ name: groupName, isDirect: true, createdBy: callerId })
    .returning();

  await db.insert(groupMembersTable).values([
    { groupId: group.id, memberId: callerId, roleInGroup: "member" },
    { groupId: group.id, memberId: otherId, roleInGroup: "member" },
  ]);

  res.status(201).json({ group: { id: group.id, name: group.name } });
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
      isDirect: groupsTable.isDirect,
      readReceiptsEnabled: groupsTable.readReceiptsEnabled,
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

// POST /api/groups/:id/messages — send a message (text or media)
// Body: { content?: string, content_type: 'text'|'image'|'audio'|'document',
//         media_url?, media_name?, media_mime?, media_size? }
router.post("/groups/:id/messages", async (req, res): Promise<void> => {
  const memberId = req.auth!.sub;
  const groupId = req.params.id as string;

  const {
    content = "",
    content_type: rawContentType,
    media_url: mediaUrl,
    media_name: mediaName,
    media_mime: mediaMime,
    media_size: mediaSize,
  } = req.body as {
    content?: string;
    content_type?: string;
    media_url?: string;
    media_name?: string;
    media_mime?: string;
    media_size?: number;
  };

  const validTypes = ["text", "image", "audio", "document"] as const;
  const contentType = validTypes.includes(rawContentType as any)
    ? (rawContentType as (typeof validTypes)[number])
    : "text";

  const isMedia = contentType !== "text";
  if (!content.trim() && (!isMedia || !mediaUrl)) {
    res.status(400).json({ error: "Message must contain text or media" });
    return;
  }

  // Verify membership
  const [membership] = await db
    .select({ roleInGroup: groupMembersTable.roleInGroup })
    .from(groupMembersTable)
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

  // Resolve sender details
  const [sender] = await db
    .select({ fullName: membersTable.fullName, avatar: membersTable.avatar })
    .from(membersTable)
    .where(eq(membersTable.id, memberId));

  const [saved] = await db
    .insert(messagesTable)
    .values({
      groupId,
      senderId: memberId,
      content: content.trim(),
      contentType,
      mediaUrl: isMedia ? mediaUrl ?? null : null,
      mediaName: isMedia ? mediaName ?? null : null,
      mediaMime: isMedia ? mediaMime ?? null : null,
      mediaSize: isMedia ? mediaSize ?? null : null,
      deliveredAt: new Date(),
    })
    .returning();

  const message = {
    type: "message" as const,
    id: saved.id,
    groupId: saved.groupId,
    senderId: saved.senderId,
    senderName: sender?.fullName ?? memberId,
    senderAvatar: sender?.avatar ?? null,
    content: saved.content,
    contentType: saved.contentType,
    mediaUrl: saved.mediaUrl,
    mediaName: saved.mediaName,
    mediaMime: saved.mediaMime,
    mediaSize: saved.mediaSize,
    createdAt: saved.createdAt,
  };

  // Broadcast in real-time to group members
  try {
    const { broadcastToGroup } = await import("../lib/ws-broadcast");
    await broadcastToGroup(groupId, message);
  } catch (err) {
    logger.warn({ err }, "Failed to broadcast message via WebSocket");
  }

  // Push notifications to other members
  try {
    const memberIds = await getGroupMemberIds(groupId);
    const recipients = memberIds.filter((id) => id !== memberId);
    const [group] = await db
      .select({ isDirect: groupsTable.isDirect })
      .from(groupsTable)
      .where(eq(groupsTable.id, groupId));
    const pushBody = isMedia
      ? `${content.trim() || (contentType === "image" ? "Photo" : contentType === "audio" ? "Voice note" : "Document")}`
      : content.trim();
    const { sendNewMessagePush } = await import("../lib/push");
    await sendNewMessagePush(
      groupId,
      memberId,
      recipients,
      pushBody,
      group?.isDirect,
    );
  } catch (err) {
    logger.warn({ err }, "Failed to send push notifications");
  }

  res.status(201).json({ message });
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
      mediaUrl: messagesTable.mediaUrl,
      mediaName: messagesTable.mediaName,
      mediaMime: messagesTable.mediaMime,
      mediaSize: messagesTable.mediaSize,
      deliveredAt: messagesTable.deliveredAt,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .innerJoin(membersTable, eq(messagesTable.senderId, membersTable.id))
    .where(whereClause)
    .orderBy(desc(messagesTable.createdAt))
    .limit(limit);

  // Fetch read receipts if enabled for this group
  const [groupCfg] = await db
    .select({ readReceiptsEnabled: groupsTable.readReceiptsEnabled })
    .from(groupsTable)
    .where(eq(groupsTable.id, groupId));

  const messageIds = messages.map((m) => m.id);
  const readsMap = new Map<string, string[]>();
  if (groupCfg?.readReceiptsEnabled && messageIds.length > 0) {
    const reads = await db
      .select({
        messageId: messageReadsTable.messageId,
        memberId: messageReadsTable.memberId,
      })
      .from(messageReadsTable)
      .where(inArray(messageReadsTable.messageId, messageIds));
    for (const r of reads) {
      const list = readsMap.get(r.messageId) ?? [];
      list.push(r.memberId);
      readsMap.set(r.messageId, list);
    }
  }

  const payload = messages.reverse().map((m) => ({
    ...m,
    readBy: groupCfg?.readReceiptsEnabled ? (readsMap.get(m.id) ?? []) : undefined,
  }));

  res.json({ messages: payload, hasMore: messages.length === limit });
});

// POST /api/groups/:id/read — mark all unread messages as read
router.post("/groups/:id/read", async (req, res): Promise<void> => {
  const memberId = req.auth!.sub;
  const groupId = req.params.id as string;

  // Verify membership
  const [membership] = await db
    .select({ roleInGroup: groupMembersTable.roleInGroup })
    .from(groupMembersTable)
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

  const [groupCfg] = await db
    .select({ readReceiptsEnabled: groupsTable.readReceiptsEnabled })
    .from(groupsTable)
    .where(eq(groupsTable.id, groupId));

  if (!groupCfg?.readReceiptsEnabled) {
    res.json({ read: false, reason: "Read receipts are disabled for this group" });
    return;
  }

  // Mark all messages in the group not already read by this member
  const unreadMessages = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .leftJoin(
      messageReadsTable,
      and(
        eq(messageReadsTable.messageId, messagesTable.id),
        eq(messageReadsTable.memberId, memberId),
      ),
    )
    .where(
      and(
        eq(messagesTable.groupId, groupId),
        eq(messageReadsTable.messageId, sql`NULL`),
      ),
    );

  if (unreadMessages.length > 0) {
    await db.insert(messageReadsTable).values(
      unreadMessages.map((m) => ({
        messageId: m.id,
        memberId,
        readAt: new Date(),
      })),
    );
  }

  // Broadcast read receipt to other members (no-op if WS not connected)
  try {
    const { sendReadReceipt } = await import("../lib/ws-broadcast");
    await sendReadReceipt(groupId, memberId, unreadMessages.map((m) => m.id));
  } catch {
    // If the broadcast helper is not available, the messages are still marked read
  }

  res.json({ read: true, count: unreadMessages.length });
});

export default router;
