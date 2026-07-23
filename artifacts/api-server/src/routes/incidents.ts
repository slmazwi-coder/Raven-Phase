import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  groupMembersTable,
  groupsTable,
  incidentsTable,
  membersTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/requireAuth";

const router: IRouter = Router();

router.use("/incidents", requireAuth);

const VALID_EVENT_TYPES = ["screenshot", "recording_start", "recording_stop"] as const;
type EventType = (typeof VALID_EVENT_TYPES)[number];

function policyForEvent(
  eventType: EventType,
  group: typeof groupsTable.$inferSelect,
): "warn" | "mute" | "remove" | "ban" {
  if (eventType === "screenshot") return group.screenshotPolicy;
  return group.screenRecordingPolicy;
}

// POST /api/incidents/report
// Authenticated — record a screenshot/screen-recording incident and apply the
// group's enforcement policy.
router.post("/incidents/report", async (req, res): Promise<void> => {
  const memberId = req.auth!.sub;
  const { group_id: groupId, event_type: eventType, timestamp } = req.body as {
    group_id?: string;
    event_type?: string;
    timestamp?: number;
  };

  if (!groupId || typeof groupId !== "string") {
    res.status(400).json({ error: "group_id is required" });
    return;
  }
  if (!VALID_EVENT_TYPES.includes(eventType as EventType)) {
    res.status(400).json({ error: "event_type must be screenshot, recording_start, or recording_stop" });
    return;
  }
  if (typeof timestamp !== "number") {
    res.status(400).json({ error: "timestamp is required" });
    return;
  }

  // Verify the caller is a current member of the group
  const [membership] = await db
    .select()
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

  // Resolve the group's enforcement policy
  const [group] = await db
    .select()
    .from(groupsTable)
    .where(eq(groupsTable.id, groupId));

  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const action = policyForEvent(eventType as EventType, group);
  const recordedAt = new Date(timestamp);

  // Apply enforcement
  let enforcement: { action: typeof action; mutedUntil?: string } = { action };

  if (action === "mute") {
    const mutedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db
      .update(groupMembersTable)
      .set({ mutedUntil })
      .where(
        and(
          eq(groupMembersTable.groupId, groupId),
          eq(groupMembersTable.memberId, memberId),
        ),
      );
    enforcement = { action, mutedUntil: mutedUntil.toISOString() };
  } else if (action === "remove") {
    await db
      .delete(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.groupId, groupId),
          eq(groupMembersTable.memberId, memberId),
        ),
      );
  } else if (action === "ban") {
    await db
      .update(membersTable)
      .set({ status: "suspended" })
      .where(eq(membersTable.id, memberId));
    await db
      .delete(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.groupId, groupId),
          eq(groupMembersTable.memberId, memberId),
        ),
      );
  }

  await db.insert(incidentsTable).values({
    memberId,
    groupId,
    eventType: eventType as EventType,
    recordedAt,
    actionTaken: action,
  });

  res.json({ ok: true, enforcement });
});

export default router;
