import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { membersTable } from "./members";
import { groupsTable } from "./groups";

export const incidentEventTypeEnum = pgEnum("incident_event_type", [
  "screenshot",
  "recording_start",
  "recording_stop",
]);

export const incidentActionTakenEnum = pgEnum("incident_action_taken", [
  "none",
  "warn",
  "mute",
  "remove",
  "ban",
]);

export const incidentsTable = pgTable("incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => membersTable.id),
  groupId: uuid("group_id").references(() => groupsTable.id),
  eventType: incidentEventTypeEnum("event_type").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  actionTaken: incidentActionTakenEnum("action_taken").notNull().default("none"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertIncidentSchema = createInsertSchema(incidentsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertIncident = z.infer<typeof insertIncidentSchema>;
export type Incident = typeof incidentsTable.$inferSelect;
