import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  groupMembersTable,
  groupsTable,
  incidentsTable,
  membersTable,
  messageReadsTable,
  messagesTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/requireAuth";
import { logger } from "../lib/logger";
import { broadcastToGroup, getGroupMemberIds } from "../lib/ws-broadcast";

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
      createdBy: groupsTable.createdBy,
      createdAt: groupsTable.createdAt,
      roleInGroup: groupMembersTable.roleInGroup,
      joinedAt: groupMembersTable.joinedAt,
    })
    .from(groupMembersTable)
    .innerJoin(groupsTable, eq(groupMembersTable.groupId, groupsTable.id))
    .where(eq(groupMembersTable.memberId, memberId))
    .orderBy(desc(groupsTable.createdAt));

  const groupIds = rows.map((r) => r.id);

  // Latest message per group
  const lastMessageMap = new Map<string, { content: string; createdAt: Date; senderName?: string; contentType: string; mediaName?: string | null }>();
  if (groupIds.length > 0) {
    const latestMessages = await db
      .select({
        groupId: messagesTable.groupId,
        content: messagesTable.content,
        createdAt: messagesTable.createdAt,
        senderId: messagesTable.senderId,
        senderName: membersTable.fullName,
        contentType: messagesTable.contentType,
        mediaName: messagesTable.mediaName,
      })
      .from(messagesTable)
      .innerJoin(membersTable, eq(messagesTable.senderId, membersTable.id))
      .where(inArray(messagesTable.groupId, groupIds))
      .orderBy(desc(messagesTable.createdAt));

    for (const m of latestMessages) {
      if (!lastMessageMap.has(m.groupId)) {
        lastMessageMap.set(m.groupId, m);
      }
    }
  }

  // Unread count per group
  const unreadMap = new Map<string, number>();
  if (groupIds.length > 0) {
    const joinedAtMap = new Map(rows.map((r) => [r.id, r.joinedAt]));
    const messageRows = await db
      .select({
        groupId: messagesTable.groupId,
        id: messagesTable.id,
        senderId: messagesTable.senderId,
        createdAt: messagesTable.createdAt,
        readMemberId: messageReadsTable.memberId,
      })
      .from(messagesTable)
      .leftJoin(
        messageReadsTable,
        and(
          eq(messageReadsTable.messageId, messagesTable.id),
          eq(messageReadsTable.memberId, memberId),
        ),
      )
      .where(inArray(messagesTable.groupId, groupIds));

    for (const m of messageRows) {
      if (m.senderId === memberId) continue;
      if (m.readMemberId) continue;
      const joinedAt = joinedAtMap.get(m.groupId);
      if (joinedAt && m.createdAt.getTime() <= joinedAt.getTime()) continue;
      unreadMap.set(m.groupId, (unreadMap.get(m.groupId) ?? 0) + 1);
    }
  }

  // Member counts
  const memberCountMap = new Map<string, number>();
  if (groupIds.length > 0) {
    const counts = await db
      .select({ groupId: groupMembersTable.groupId, count: sql<number>`count(*)`.as("count") })
      .from(groupMembersTable)
      .where(inArray(groupMembersTable.groupId, groupIds))
      .groupBy(groupMembersTable.groupId);
    for (const c of counts) {
      memberCountMap.set(c.groupId, c.count);
    }
  }

  // Direct group avatars/names of the other participant
  const directMetaMap = new Map<string, { avatar?: string | null; fullName: string; isOnline?: boolean }>();
  const directGroupIds = rows.filter((r) => r.isDirect).map((r) => r.id);
  if (directGroupIds.length > 0) {
    const metaRows = await db
      .select({
        groupId: groupMembersTable.groupId,
        avatar: membersTable.avatar,
        fullName: membersTable.fullName,
        isOnline: membersTable.isOnline,
        lastSeenAt: membersTable.lastSeenAt,
      })
      .from(groupMembersTable)
      .innerJoin(membersTable, eq(groupMembersTable.memberId, membersTable.id))
      .where(and(inArray(groupMembersTable.groupId, directGroupIds), ne(groupMembersTable.memberId, memberId)));
    for (const m of metaRows) {
      const online = m.lastSeenAt != null && Date.now() - new Date(m.lastSeenAt).getTime() < 2 * 60 * 1000;
      directMetaMap.set(m.groupId, {
        avatar: m.avatar,
        fullName: m.fullName,
        isOnline: m.isOnline || online,
      });
    }
  }

  const groups = rows.map((r) => {
    const last = lastMessageMap.get(r.id);
    const directMeta = directMetaMap.get(r.id);
    const name = r.isDirect && directMeta ? directMeta.fullName : r.name;
    const avatar = r.isDirect ? directMeta?.avatar ?? null : null;
    return {
      ...r,
      name,
      avatar,
      memberCount: Number(memberCountMap.get(r.id) ?? 1),
      lastMessage: last
        ? {
            content: last.content,
            createdAt: last.createdAt,
            senderName: r.isDirect ? undefined : last.senderName,
            contentType: last.contentType,
            mediaName: last.mediaName,
          }
        : null,
      unreadCount: unreadMap.get(r.id) ?? 0,
      otherIsOnline: r.isDirect ? directMeta?.isOnline ?? false : undefined,
    };
  });

  res.json({ groups });
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

// GET /api/members/me/privacy — current privacy settings
router.get("/members/me/privacy", async (req, res): Promise<void> => {
  const memberId = req.auth!.sub;

  const [member] = await db
    .select({
      lastSeenEnabled: membersTable.lastSeenEnabled,
      readReceiptsEnabled: membersTable.readReceiptsEnabled,
    })
    .from(membersTable)
    .where(eq(membersTable.id, memberId));

  if (!member) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  res.json({ privacy: member });
});

// PATCH /api/members/me/privacy — toggle last seen and read receipts
router.patch("/members/me/privacy", async (req, res): Promise<void> => {
  const memberId = req.auth!.sub;
  const { last_seen_enabled: lastSeenEnabled, read_receipts_enabled: readReceiptsEnabled } = req.body as {
    last_seen_enabled?: boolean;
    read_receipts_enabled?: boolean;
  };

  const updates: Partial<{ lastSeenEnabled: boolean; readReceiptsEnabled: boolean; updatedAt: Date }> = {
    updatedAt: new Date(),
  };
  if (typeof lastSeenEnabled === "boolean") updates.lastSeenEnabled = lastSeenEnabled;
  if (typeof readReceiptsEnabled === "boolean") updates.readReceiptsEnabled = readReceiptsEnabled;

  const [updated] = await db
    .update(membersTable)
    .set(updates)
    .where(eq(membersTable.id, memberId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  res.json({ privacy: { lastSeenEnabled: updated.lastSeenEnabled, readReceiptsEnabled: updated.readReceiptsEnabled } });
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

// GET /api/members/:id — public profile for any authenticated member
// Admins and the member themself see the phone number; otherwise it's hidden.
router.get("/members/:id", async (req, res): Promise<void> => {
  const callerId = req.auth!.sub;
  const callerRole = req.auth!.role;
  const targetId = req.params.id as string;

  const [member] = await db
    .select({
      id: membersTable.id,
      fullName: membersTable.fullName,
      avatar: membersTable.avatar,
      cellNumber: membersTable.cellNumber,
      role: membersTable.role,
      status: membersTable.status,
      isOnline: membersTable.isOnline,
      lastSeenAt: membersTable.lastSeenAt,
      lastSeenEnabled: membersTable.lastSeenEnabled,
      createdAt: membersTable.createdAt,
    })
    .from(membersTable)
    .where(eq(membersTable.id, targetId))
    .limit(1);

  if (!member) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  const isSelf = callerId === targetId;
  const isAdmin = callerRole === "admin";
  const showPhone = isSelf || isAdmin;
  const showPresence = isSelf || member.lastSeenEnabled;

  // Derive online status from last seen so REST servers (which don't share
  // WebSocket state with the Railway WS service) still report presence.
  const isOnlineFromPresence =
    member.lastSeenAt != null &&
    Date.now() - new Date(member.lastSeenAt).getTime() < 2 * 60 * 1000;

  res.json({
    member: {
      id: member.id,
      fullName: member.fullName,
      avatar: member.avatar,
      role: member.role,
      status: member.status,
      isOnline: showPresence ? isOnlineFromPresence : null,
      lastSeenAt: showPresence ? member.lastSeenAt : null,
      cellNumber: showPhone ? member.cellNumber : undefined,
      createdAt: member.createdAt,
    },
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
      createdBy: groupsTable.createdBy,
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

  const [countRow] = await db
    .select({ count: sql<number>`count(*)`.as("count") })
    .from(groupMembersTable)
    .where(eq(groupMembersTable.groupId, groupId));

  res.json({ group: { ...membership, memberCount: Number(countRow?.count ?? 1) } });
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

  // Mark all messages in the group not already read by this member.
  // This always clears the local unread badge; read-receipt broadcasts
  // are only sent when the group has read receipts enabled.
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
        isNull(messageReadsTable.memberId),
      ),
    );

  if (unreadMessages.length > 0) {
    await db
      .insert(messageReadsTable)
      .values(
        unreadMessages.map((m) => ({
          messageId: m.id,
          memberId,
          readAt: new Date(),
        })),
      )
      .onConflictDoNothing();
  }

  // Broadcast read receipt to other members only when read receipts are enabled
  if (groupCfg?.readReceiptsEnabled) {
    try {
      const { sendReadReceipt } = await import("../lib/ws-broadcast");
      await sendReadReceipt(groupId, memberId, unreadMessages.map((m) => m.id));
    } catch {
      // If the broadcast helper is not available, the messages are still marked read
    }
  }

  res.json({ read: true, count: unreadMessages.length });
});

// POST /api/groups/:id/leave — authenticated member leaves the group
// For direct groups, leaving deletes the conversation entirely.
router.post("/groups/:id/leave", async (req, res): Promise<void> => {
  const groupId = req.params.id as string;
  const memberId = req.auth!.sub;

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

  const [group] = await db
    .select({ isDirect: groupsTable.isDirect, createdBy: groupsTable.createdBy })
    .from(groupsTable)
    .where(eq(groupsTable.id, groupId));

  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  await db.transaction(async (tx) => {
    // For direct chats, one person leaving deletes the whole conversation.
    if (group.isDirect) {
      await tx.delete(groupMembersTable).where(eq(groupMembersTable.groupId, groupId));
      await tx.delete(messagesTable).where(eq(messagesTable.groupId, groupId));
      await tx
        .update(incidentsTable)
        .set({ groupId: null })
        .where(eq(incidentsTable.groupId, groupId));
      await tx.delete(groupsTable).where(eq(groupsTable.id, groupId));
      return;
    }

    await tx
      .delete(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.groupId, groupId),
          eq(groupMembersTable.memberId, memberId),
        ),
      );

    const remaining = await tx
      .select({ memberId: groupMembersTable.memberId, roleInGroup: groupMembersTable.roleInGroup, joinedAt: groupMembersTable.joinedAt })
      .from(groupMembersTable)
      .where(eq(groupMembersTable.groupId, groupId))
      .orderBy(asc(groupMembersTable.joinedAt));

    if (remaining.length === 0) {
      await tx.delete(messagesTable).where(eq(messagesTable.groupId, groupId));
      await tx
        .update(incidentsTable)
        .set({ groupId: null })
        .where(eq(incidentsTable.groupId, groupId));
      await tx.delete(groupsTable).where(eq(groupsTable.id, groupId));
    } else if (membership.roleInGroup === "admin" && !remaining.some((m) => m.roleInGroup === "admin")) {
      // Transfer admin to the longest-tenured remaining member
      await tx
        .update(groupMembersTable)
        .set({ roleInGroup: "admin" })
        .where(
          and(
            eq(groupMembersTable.groupId, groupId),
            eq(groupMembersTable.memberId, remaining[0].memberId),
          ),
        );
    }
  });

  try {
    if (group.isDirect) {
      await broadcastToGroup(groupId, { type: "group_deleted", groupId }, memberId);
    } else {
      await broadcastToGroup(groupId, { type: "member_left", groupId, memberId }, memberId);
    }
  } catch {
    // WS broadcast is best-effort
  }

  res.json({ left: true, deleted: group.isDirect });
});

// POST /api/groups/:id/delete — admin or group creator deletes the group
router.post("/groups/:id/delete", async (req, res): Promise<void> => {
  const groupId = req.params.id as string;
  const memberId = req.auth!.sub;

  const [membership] = await db
    .select({ roleInGroup: groupMembersTable.roleInGroup })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.memberId, memberId),
      ),
    );

  const [group] = await db
    .select({ createdBy: groupsTable.createdBy })
    .from(groupsTable)
    .where(eq(groupsTable.id, groupId));

  if (!group || !membership) {
    res.status(404).json({ error: "Group not found or you are not a member" });
    return;
  }

  const canDelete = membership.roleInGroup === "admin" || group.createdBy === memberId;
  if (!canDelete) {
    res.status(403).json({ error: "Only admins can delete this group" });
    return;
  }

  const memberIds = await getGroupMemberIds(groupId);

  await db.transaction(async (tx) => {
    await tx.delete(groupMembersTable).where(eq(groupMembersTable.groupId, groupId));
    await tx.delete(messagesTable).where(eq(messagesTable.groupId, groupId));
    await tx
      .update(incidentsTable)
      .set({ groupId: null })
      .where(eq(incidentsTable.groupId, groupId));
    await tx.delete(groupsTable).where(eq(groupsTable.id, groupId));
  });

  try {
    for (const id of memberIds) {
      if (id === memberId) continue;
      const sockets = (await import("../lib/ws-broadcast")).clientsByMember.get(id);
      if (!sockets) continue;
      for (const sock of sockets) {
        if (sock.readyState === (await import("ws")).WebSocket.OPEN) {
          sock.send(JSON.stringify({ type: "group_deleted", groupId }));
        }
      }
    }
  } catch {
    // WS broadcast is best-effort
  }

  res.json({ deleted: true });
});

// POST /api/groups/:id/remove-member — admin removes another member
router.post("/groups/:id/remove-member", async (req, res): Promise<void> => {
  const groupId = req.params.id as string;
  const callerId = req.auth!.sub;
  const { member_id: targetId } = req.body as { member_id?: string };

  if (!targetId || typeof targetId !== "string") {
    res.status(400).json({ error: "member_id is required" });
    return;
  }

  if (targetId === callerId) {
    res.status(400).json({ error: "Use leave to remove yourself" });
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
    res.status(403).json({ error: "Only admins can remove members" });
    return;
  }

  const [targetMembership] = await db
    .select({ memberId: groupMembersTable.memberId })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.memberId, targetId),
      ),
    );

  if (!targetMembership) {
    res.status(404).json({ error: "Member not found in this group" });
    return;
  }

  await db
    .delete(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.memberId, targetId),
      ),
    );

  try {
    await broadcastToGroup(groupId, { type: "member_removed", groupId, memberId: targetId }, callerId);
  } catch {
    // best-effort
  }

  res.json({ removed: true });
});

// POST /api/groups/:id/clear — admin clears all messages in the group
router.post("/groups/:id/clear", async (req, res): Promise<void> => {
  const groupId = req.params.id as string;
  const memberId = req.auth!.sub;

  const [membership] = await db
    .select({ roleInGroup: groupMembersTable.roleInGroup })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.memberId, memberId),
      ),
    );

  if (!membership || membership.roleInGroup !== "admin") {
    res.status(403).json({ error: "Only admins can clear chat history" });
    return;
  }

  await db.delete(messagesTable).where(eq(messagesTable.groupId, groupId));

  try {
    await broadcastToGroup(groupId, { type: "chat_cleared", groupId }, memberId);
  } catch {
    // best-effort
  }

  res.json({ cleared: true });
});

export default router;
