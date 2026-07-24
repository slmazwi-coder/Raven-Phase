import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from './api';

export type WsMessage = ChatMessage;

interface TypingUser {
  memberId: string;
  name?: string;
  until: number;
}

export function useGroupChat(
  groupId: string | null,
  token: string | null,
  options?: { markRead?: () => void },
) {
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [presence, setPresence] = useState<Record<string, boolean>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadRef = useRef(options?.markRead);
  markReadRef.current = options?.markRead;

  useEffect(() => {
    if (!token || !groupId) return;

    const domain =
      process.env.EXPO_PUBLIC_WS_DOMAIN || process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) {
      console.warn(
        '[ws] EXPO_PUBLIC_WS_DOMAIN / EXPO_PUBLIC_DOMAIN not set — WebSocket disabled',
      );
      return;
    }

    const protocol = 'wss';
    const url = `${protocol}://${domain}/ws?token=${encodeURIComponent(token)}`;

    let ws: WebSocket;
    let closed = false;

    try {
      ws = new WebSocket(url);
      wsRef.current = ws;
    } catch (err) {
      console.error('[ws] Failed to create WebSocket:', err);
      return;
    }

    ws.onopen = () => {
      if (!closed) setIsConnected(true);
    };
    ws.onclose = () => {
      if (!closed) setIsConnected(false);
    };
    ws.onerror = () => {
      if (!closed) setIsConnected(false);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(
          typeof event.data === 'string' ? event.data : event.data.toString(),
        );

        if (msg.type === 'message' && msg.groupId === groupId) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [msg as WsMessage, ...prev];
          });
        } else if (msg.type === 'typing' && msg.groupId === groupId) {
          const until = Date.now() + 3500;
          setTypingUsers((prev) => {
            const filtered = prev.filter((u) => u.memberId !== msg.memberId);
            if (!msg.isTyping) return filtered;
            return [...filtered, { memberId: msg.memberId, until }];
          });
        } else if (msg.type === 'presence') {
          setPresence((prev) => ({ ...prev, [msg.memberId]: msg.online }));
        } else if (msg.type === 'read' && msg.groupId === groupId) {
          setMessages((prev) =>
            prev.map((m) => {
              if (msg.messageIds?.includes(m.id)) {
                const set = new Set(m.readBy ?? []);
                set.add(msg.memberId);
                return { ...m, readBy: Array.from(set) };
              }
              return m;
            }),
          );
        }
      } catch {
        // ignore malformed frames
      }
    };

    const clearStaleTyping = setInterval(() => {
      const now = Date.now();
      setTypingUsers((prev) => prev.filter((u) => u.until > now));
    }, 1000);

    return () => {
      closed = true;
      clearInterval(clearStaleTyping);
      ws.close();
      wsRef.current = null;
      setIsConnected(false);
    };
  }, [groupId, token]);

  const sendMessage = useCallback(
    (content: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'send_message', groupId, content }));
      }
    },
    [groupId],
  );

  const sendTyping = useCallback(
    (isTyping: boolean) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'typing', groupId, isTyping }));
      }
    },
    [groupId],
  );

  const notifyTyping = useCallback(() => {
    sendTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      sendTyping(false);
    }, 3000);
  }, [sendTyping]);

  const prependHistory = useCallback((history: WsMessage[]) => {
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      const fresh = history.filter((m) => !ids.has(m.id));
      return [...prev, ...fresh];
    });
  }, []);

  const markMessageRead = useCallback((messageId: string) => {
    // Read receipts are batched through the markRead callback
    markReadRef.current?.();
  }, []);

  const updateMessage = useCallback(
    (message: WsMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [message, ...prev];
      });
    },
    [setMessages],
  );

  return {
    messages,
    isConnected,
    typingUsers,
    presence,
    sendMessage,
    sendTyping,
    notifyTyping,
    prependHistory,
    markMessageRead,
    updateMessage,
  };
}
