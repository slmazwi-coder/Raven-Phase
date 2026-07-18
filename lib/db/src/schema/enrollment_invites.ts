import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { membersTable } from "./members";

export const enrollmentInvitesTable = pgTable("enrollment_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  cellNumber: text("cell_number").notNull(),
  invitedBy: uuid("invited_by")
    .notNull()
    .references(() => membersTable.id),
  /** Single-use, cryptographically random hex token */
  token: text("token").unique().notNull(),
  /** 48 hours from creation */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertEnrollmentInviteSchema = createInsertSchema(
  enrollmentInvitesTable,
).omit({ id: true, createdAt: true });
export type InsertEnrollmentInvite = z.infer<
  typeof insertEnrollmentInviteSchema
>;
export type EnrollmentInvite = typeof enrollmentInvitesTable.$inferSelect;
