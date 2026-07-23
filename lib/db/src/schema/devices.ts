import { boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { membersTable } from "./members";

export const devicePlatformEnum = pgEnum("device_platform", ["ios", "android"]);

export const devicesTable = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => membersTable.id),
  platform: devicePlatformEnum("platform").notNull(),
  /** Placeholder: will bind to App Attest / Play Integrity in a later phase */
  deviceIdentifier: text("device_identifier").notNull(),
  /** Raw attestation token from App Attest / Play Integrity */
  attestation: text("attestation"),
  /**
   * Task 4 — Encryption groundwork:
   * Placeholder for Signal Protocol X3DH identity public key (IK_pub).
   * This field is intentionally nullable now; Phase 2 will make it required
   * once libsignal key generation is implemented on the client.
   */
  publicKey: text("public_key"),
  allowListed: boolean("allow_listed").notNull().default(true),
  registeredAt: timestamp("registered_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const insertDeviceSchema = createInsertSchema(devicesTable).omit({
  id: true,
  registeredAt: true,
});
export type InsertDevice = z.infer<typeof insertDeviceSchema>;
export type Device = typeof devicesTable.$inferSelect;
