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
}

/** memberId → all connected sockets for that member */
const clientsByMember = new Map<string, Set<AuthedSocket>>();

export function createWsServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: AuthedSocket, req) => {
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

    // Register socket
    if (!clientsByMember.has(auth.sub)) {
      clientsByMember.set(auth.sub, new Set());
    }
    clientsByMember.get(auth.sub)!.add(ws);
    logger.info({ memberId: auth.sub }, "WS client connected");

    ws.on("message", async (data) => {
      try {
        const raw = typeof data === "string" ? data : data.toString();
        const msg = JSON.parse(raw) as {
          type: string;
          groupId?: string;
          content?: string;
        };

        if (msg.type !== "send_message" || !msg.groupId || !msg.content?.trim()) {
          return;
        }

        const memberId = ws.memberId!;
        const { groupId, content } = msg;

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

        // Resolve sender display name
        const [sender] = await db
          .select({ fullName: membersTable.fullName })
          .from(membersTable)
          .where(eq(membersTable.id, memberId));

        // Persist message and mark as delivered immediately (Phase 2)
        const [saved] = await db
          .insert(messagesTable)
          .values({
            groupId,
            senderId: memberId,
            content: content.trim(),
            contentType: "text",
            deliveredAt: new Date(),
          })
          .returning();

        // Fetch all group members to broadcast to
        const groupMembers = await db
          .select({ memberId: groupMembersTable.memberId })
          .from(groupMembersTable)
          .where(eq(groupMembersTable.groupId, groupId));

        const outbound = JSON.stringify({
          type: "message",
          id: saved.id,
          groupId: saved.groupId,
          senderId: saved.senderId,
          senderName: sender?.fullName ?? memberId,
          content: saved.content,
          contentType: saved.contentType,
          createdAt: saved.createdAt,
        });

        for (const { memberId: gm } of groupMembers) {
          const sockets = clientsByMember.get(gm);
          if (!sockets) continue;
          for (const sock of sockets) {
            if (sock.readyState === WebSocket.OPEN) {
              sock.send(outbound);
            }
          }
        }
      } catch (err) {
        logger.error({ err }, "WS message handler error");
      }
    });

    ws.on("close", () => {
      const { memberId } = ws;
      if (!memberId) return;
      const set = clientsByMember.get(memberId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) clientsByMember.delete(memberId);
      }
      logger.info({ memberId }, "WS client disconnected");
    });
  });

  return wss;
}
