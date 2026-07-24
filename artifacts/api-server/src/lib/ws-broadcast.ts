import { WebSocket } from "ws";
import { db } from "@workspace/db";
import { groupMembersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export interface ClientSocket extends WebSocket {
  memberId?: string;
  typingTimeouts?: Map<string, ReturnType<typeof setTimeout>>;
}

/** memberId → all connected sockets for that member */
export const clientsByMember = new Map<string, Set<ClientSocket>>();

export async function getMemberGroups(memberId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: groupMembersTable.groupId })
    .from(groupMembersTable)
    .where(eq(groupMembersTable.memberId, memberId));
  return rows.map((r) => r.groupId);
}

export async function getGroupMemberIds(groupId: string): Promise<string[]> {
  const rows = await db
    .select({ memberId: groupMembersTable.memberId })
    .from(groupMembersTable)
    .where(eq(groupMembersTable.groupId, groupId));
  return rows.map((r) => r.memberId);
}

export function sendToMember(memberId: string, payload: object) {
  const sockets = clientsByMember.get(memberId);
  if (!sockets) return;
  const message = JSON.stringify(payload);
  for (const sock of sockets) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(message);
    }
  }
}

export async function broadcastToGroup(
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

export async function sendReadReceipt(
  groupId: string,
  memberId: string,
  messageIds: string[],
) {
  if (messageIds.length === 0) return;
  await broadcastToGroup(groupId, {
    type: "read",
    groupId,
    memberId,
    messageIds,
  });
}
