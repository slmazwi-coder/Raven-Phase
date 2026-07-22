import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { membersTable } from "./members";
import { groupsTable } from "./groups";

export const messageContentTypeEnum = pgEnum("message_content_type", ["text"]);

export const messagesTable = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groupsTable.id),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => membersTable.id),
  content: text("content").notNull(),
  contentType: messageContentTypeEnum("content_type").notNull().default("text"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Message = typeof messagesTable.$inferSelect;
