import { Expo, ExpoPushMessage } from "expo-server-sdk";
import { db } from "@workspace/db";
import { devicesTable, membersTable } from "@workspace/db";
import { eq, inArray, and, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

export async function sendNewMessagePush(
  groupId: string,
  senderId: string,
  recipientIds: string[],
  body: string,
  isDirect?: boolean,
) {
  if (recipientIds.length === 0) return;

  const [sender] = await db
    .select({ fullName: membersTable.fullName })
    .from(membersTable)
    .where(eq(membersTable.id, senderId));

  const senderName = sender?.fullName ?? "Raven";
  const title = isDirect ? senderName : "Raven";

  const devices = await db
    .select({ pushToken: devicesTable.pushToken })
    .from(devicesTable)
    .where(
      and(
        inArray(devicesTable.memberId, recipientIds),
        isNotNull(devicesTable.pushToken),
      ),
    );

  const tokens = devices
    .map((d) => d.pushToken)
    .filter((t): t is string => Expo.isExpoPushToken(t));

  if (tokens.length === 0) return;

  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    to: token,
    sound: "default",
    title,
    body,
    data: { groupId, senderId },
  }));

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const receipts = await expo.sendPushNotificationsAsync(chunk);
      logger.debug({ receipts }, "Push notifications sent");
    } catch (err) {
      logger.error({ err }, "Failed to send push notifications");
    }
  }
}
