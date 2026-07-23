import {
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { membersTable } from "./members";

export const groupRoleEnum = pgEnum("group_role", [
  "admin",
  "moderator",
  "member",
]);

export const groupPolicyEnum = pgEnum("group_policy", [
  "warn",
  "mute",
  "remove",
  "ban",
]);

export const groupsTable = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  screenshotPolicy: groupPolicyEnum("screenshot_policy")
    .notNull()
    .default("warn"),
  screenRecordingPolicy: groupPolicyEnum("screen_recording_policy")
    .notNull()
    .default("warn"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => membersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const groupMembersTable = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groupsTable.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id),
    roleInGroup: groupRoleEnum("role_in_group").notNull().default("member"),
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.memberId] })],
);

export const insertGroupSchema = createInsertSchema(groupsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type Group = typeof groupsTable.$inferSelect;
export type GroupMember = typeof groupMembersTable.$inferSelect;
