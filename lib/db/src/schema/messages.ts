import {
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { membersTable } from "./members";
import { groupsTable } from "./groups";

export const messageContentTypeEnum = pgEnum("message_content_type", [
  "text",
  "image",
  "audio",
  "document",
]);

export const messagesTable = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groupsTable.id),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => membersTable.id),
  content: text("content").notNull().default(""),
  contentType: messageContentTypeEnum("content_type").notNull().default("text"),
  /** Base64 data URI or external URL for image/audio/document messages */
  mediaUrl: text("media_url"),
  /** Original file name for documents/voice notes */
  mediaName: text("media_name"),
  /** MIME type of the shared media */
  mediaMime: text("media_mime"),
  /** Size in bytes */
  mediaSize: integer("media_size"),
  /** When the message was delivered to the server/broadcast */
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messageReadsTable = pgTable(
  "message_reads",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messagesTable.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.memberId] })],
);

export type Message = typeof messagesTable.$inferSelect;
