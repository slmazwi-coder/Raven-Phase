import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const memberRoleEnum = pgEnum("member_role", [
  "admin",
  "moderator",
  "member",
]);
export const memberStatusEnum = pgEnum("member_status", [
  "pending",
  "active",
  "suspended",
  "removed",
]);

export const membersTable = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  cellNumber: text("cell_number").unique().notNull(),
  email: text("email"),
  avatar: text("avatar"),
  /** Whether the member's online/last-seen status is visible to others */
  lastSeenEnabled: boolean("last_seen_enabled").notNull().default(true),
  /** Whether read receipts are sent for this member */
  readReceiptsEnabled: boolean("read_receipts_enabled").notNull().default(true),
  role: memberRoleEnum("role").notNull().default("member"),
  status: memberStatusEnum("status").notNull().default("active"),
  isOnline: boolean("is_online").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertMemberSchema = createInsertSchema(membersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof membersTable.$inferSelect;
