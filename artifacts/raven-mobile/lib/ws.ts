import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { ChatMessage } from './api';

export type WsMessage = ChatMessage;

export function useGroupChat(groupId: string | null, token: string | null) {
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token || !groupId) return;

    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) {
      console.warn('[ws] EXPO_PUBLIC_DOMAIN not set — WebSocket disabled');
      return;
    }

    // Always use wss:// — Replit proxy is TLS-terminated on all platforms
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
            // Deduplicate by id
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [msg as WsMessage, ...prev];
          });
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      closed = true;
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

  const prependHistory = useCallback((history: WsMessage[]) => {
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      const fresh = history.filter((m) => !ids.has(m.id));
      // History is ascending; WS messages prepend (descending order for inverted FlatList)
      return [...prev, ...fresh];
    });
  }, []);

  return { messages, isConnected, sendMessage, prependHistory };
}
