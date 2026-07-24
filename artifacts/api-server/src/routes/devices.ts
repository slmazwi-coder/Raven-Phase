import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { devicesTable } from "@workspace/db";
import { requireAuth } from "../middleware/requireAuth";

const router: IRouter = Router();
router.use("/devices", requireAuth);

// POST /api/devices/push-token — register or update the Expo push token for a device
// Body: { device_identifier: string, platform: 'ios' | 'android', push_token: string }
router.post("/devices/push-token", async (req, res): Promise<void> => {
  const memberId = req.auth!.sub;
  const { device_identifier: deviceIdentifier, platform, push_token: pushToken } =
    req.body as {
      device_identifier?: string;
      platform?: string;
      push_token?: string;
    };

  if (!deviceIdentifier || !pushToken) {
    res.status(400).json({ error: "device_identifier and push_token are required" });
    return;
  }

  const safePlatform = platform === "ios" ? "ios" : "android";

  // Upsert push token for this device identifier
  const [existing] = await db
    .select({ id: devicesTable.id })
    .from(devicesTable)
    .where(eq(devicesTable.deviceIdentifier, deviceIdentifier));

  if (existing) {
    const [updated] = await db
      .update(devicesTable)
      .set({
        memberId,
        platform: safePlatform,
        pushToken,
        allowListed: true,
      })
      .where(eq(devicesTable.id, existing.id))
      .returning();
    res.json({ device: updated });
    return;
  }

  const [created] = await db
    .insert(devicesTable)
    .values({
      memberId,
      deviceIdentifier,
      platform: safePlatform,
      pushToken,
      allowListed: true,
    })
    .returning();

  res.status(201).json({ device: created });
});

export default router;
