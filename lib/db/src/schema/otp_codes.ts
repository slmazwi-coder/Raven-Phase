import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const otpCodesTable = pgTable("otp_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  cellNumber: text("cell_number").notNull(),
  /** SHA-256 hash of the OTP code — plaintext is never stored */
  codeHash: text("code_hash").notNull(),
  /** 5–10 minutes from creation */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** Rate-limit counter: lock out after 5 failed attempts */
  attempts: integer("attempts").notNull().default(0),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertOtpCodeSchema = createInsertSchema(otpCodesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertOtpCode = z.infer<typeof insertOtpCodeSchema>;
export type OtpCode = typeof otpCodesTable.$inferSelect;
