/**
 * Phase 4 stub — full schema comes in Phase 4.
 * This placeholder creates the table so future migrations are additive.
 */
import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

export const actionItemsTable = pgTable("action_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ActionItem = typeof actionItemsTable.$inferSelect;
