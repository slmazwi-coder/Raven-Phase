/**
 * Phase 2 stub — full schema comes in Phase 2/4.
 * This placeholder creates the table so future migrations are additive.
 */
import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

export const messagesTable = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Message = typeof messagesTable.$inferSelect;
