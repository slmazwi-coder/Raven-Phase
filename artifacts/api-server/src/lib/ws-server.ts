import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { verifyToken } from "./auth";
import { db } from "@workspace/db";
import {
  groupMembersTable,
  membersTable,
  messagesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

interface AuthedSocket extends WebSocket {
  memberId?: string;
  typingTimeouts?: Map<string, NodeJS.Timeout>;
}

/** memberId → all connected sockets for that member */
const clientsByMember = new Map<string, Set<AuthedSocket>>();

async function getGroupMemberIds(groupId: string): Promise<string[]> {
  const rows = await db
    .select({ memberId: groupMembersTable.memberId })
    .from(groupMembersTable)
    .where(eq(groupMembersTable.groupId, groupId));
  return rows.map((r) => r.memberId);
}

async function getMemberGroups(memberId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: groupMembersTable.groupId })
    .from(groupMembersTable)
    .where(eq(groupMembersTable.memberId, memberId));
  return rows.map((r) => r.groupId);
}

function sendToMember(memberId: string, payload: object) {
  const sockets = clientsByMember.get(memberId);
  if (!sockets) return;
  const message = JSON.stringify(payload);
  for (const sock of sockets) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(message);
    }
  }
}

async function broadcastToGroup(
  groupId: string,
  payload: object,
  excludeMemberId?: string,
) {
  const memberIds = await getGroupMemberIds(groupId);
  const message = JSON.stringify(payload);
  for (const memberId of memberIds) {
    if (excludeMemberId && memberId === excludeMemberId) continue;
    const sockets = clientsByMember.get(memberId);
    if (!sockets) continue;
    for (const sock of sockets) {
      if (sock.readyState === WebSocket.OPEN) {
        sock.send(message);
      }
    }
  }
}

export function createWsServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", async (ws: AuthedSocket, req) => {
    // Authenticate via ?token= query param (WS handshake headers can't carry Authorization)
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token");

    if (!token) {
      ws.close(4001, "Missing token");
      return;
    }

    let auth: { sub: string; role: string };
    try {
      auth = verifyToken(token) as { sub: string; role: string };
    } catch {
      ws.close(4001, "Invalid or expired token");
      return;
    }

    ws.memberId = auth.sub;
    ws.typingTimeouts = new Map();

    // Register socket
    if (!clientsByMember.has(auth.sub)) {
      clientsByMember.set(auth.sub, new Set());
    }
    clientsByMember.get(auth.sub)!.add(ws);
    logger.info({ memberId: auth.sub }, "WS client connected");

    // Update last seen and announce online presence to all shared groups
    try {
      await db
        .update(membersTable)
        .set({ lastSeenAt: new Date() })
        .where(eq(membersTable.id, auth.sub));

      const groupIds = await getMemberGroups(auth.sub);
      for (const groupId of groupIds) {
        await broadcastToGroup(
          groupId,
          { type: "presence", memberId: auth.sub, online: true },
          auth.sub,
        );
      }
    } catch (err) {
      logger.error({ err, memberId: auth.sub }, "Presence broadcast error");
    }

    ws.on("message", async (data) => {
      try {
        const raw = typeof data === "string" ? data : data.toString();
        const msg = JSON.parse(raw) as {
          type: string;
          groupId?: string;
          content?: string;
          isTyping?: boolean;
        };

        const memberId = ws.memberId!;
        const { groupId } = msg;

        if (!groupId) return;

        // Verify sender is a member of the target group
        const [membership] = await db
          .select()
          .from(groupMembersTable)
          .where(
            and(
              eq(groupMembersTable.groupId, groupId),
              eq(groupMembersTable.memberId, memberId),
            ),
          );

        if (!membership) {
          ws.send(
            JSON.stringify({ type: "error", error: "Not a member of this group" }),
          );
          return;
        }

        if (msg.type === "typing") {
          await broadcastToGroup(
            groupId,
            {
              type: "typing",
              groupId,
              memberId,
              isTyping: msg.isTyping ?? true,
            },
            memberId,
          );
          return;
        }

        if (msg.type !== "send_message" || !msg.content?.trim()) {
          return;
        }

        // Resolve sender display name
        const [sender] = await db
          .select({ fullName: membersTable.fullName, avatar: membersTable.avatar })
          .from(membersTable)
          .where(eq(membersTable.id, memberId));

        // Persist message and mark as delivered immediately (Phase 2)
        const [saved] = await db
          .insert(messagesTable)
          .values({
            groupId,
            senderId: memberId,
            content: msg.content.trim(),
            contentType: "text",
            deliveredAt: new Date(),
          })
          .returning();

        await broadcastToGroup(groupId, {
          type: "message",
          id: saved.id,
          groupId: saved.groupId,
          senderId: saved.senderId,
          senderName: sender?.fullName ?? memberId,
          senderAvatar: sender?.avatar ?? null,
          content: saved.content,
          contentType: saved.contentType,
          createdAt: saved.createdAt,
        });
      } catch (err) {
        logger.error({ err }, "WS message handler error");
      }
    });

    ws.on("close", async () => {
      const { memberId } = ws;
      if (!memberId) return;

      const set = clientsByMember.get(memberId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          clientsByMember.delete(memberId);
          // Mark offline and announce to shared groups
          try {
            await db
              .update(membersTable)
              .set({ lastSeenAt: new Date() })
              .where(eq(membersTable.id, memberId));
            const groupIds = await getMemberGroups(memberId);
            for (const groupId of groupIds) {
              await broadcastToGroup(
                groupId,
                { type: "presence", memberId, online: false },
                memberId,
              );
            }
          } catch (err) {
            logger.error({ err, memberId }, "Offline broadcast error");
          }
        }
      }
      logger.info({ memberId }, "WS client disconnected");
    });
  });

  return wss;
}
