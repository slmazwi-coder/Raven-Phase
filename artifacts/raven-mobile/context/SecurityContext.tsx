import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import { useAuth } from './AuthContext';
import { reportIncident, type ReportIncidentPayload } from '@/lib/api';
import {
  refreshAttestation,
  subscribeToSecurityEvents,
  type ScreenshotEvent,
  type RecordingStateEvent,
} from '@/lib/attestation';

export interface Enforcement {
  action: 'warn' | 'mute' | 'remove' | 'ban';
  mutedUntil?: string;
}

interface SecurityContextValue {
  /** Tell the security layer which group is currently active (e.g. on chat screen). */
  setActiveGroupId: (groupId: string | null) => void;
  /** The last enforcement action returned by the backend, if any. */
  lastEnforcement: Enforcement | null;
  /** Clears the last enforcement after the app has handled it. */
  clearLastEnforcement: () => void;
}

const SecurityContext = createContext<SecurityContextValue | null>(null);

const FLUSH_INTERVAL_MS = 10_000;
const MAX_RETRIES = 5;

export function SecurityProvider({ children }: { children: React.ReactNode }) {
  const { token, member, logout } = useAuth();
  const [lastEnforcement, setLastEnforcement] = useState<Enforcement | null>(null);
  const activeGroupIdRef = useRef<string | null>(null);
  const pendingRef = useRef<ReportIncidentPayload[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (!token || pendingRef.current.length === 0) return;

    const queue = pendingRef.current;
    pendingRef.current = [];
    const failed: ReportIncidentPayload[] = [];

    for (const payload of queue) {
      try {
        const res = await reportIncident(token, payload);
        if (res.enforcement?.action) {
          setLastEnforcement(res.enforcement);
          if (res.enforcement.action === 'ban') {
            logout();
            return;
          }
        }
      } catch (err) {
        // Retry later; don't drop the report silently.
        // Track retry count by attaching metadata? Keep simple: allow MAX_RETRIES total.
        if ((payload as ReportIncidentPayload & { _retries?: number })._retries ?? 0 < MAX_RETRIES) {
          failed.push({
            ...payload,
            _retries: ((payload as ReportIncidentPayload & { _retries?: number })._retries ?? 0) + 1,
          } as ReportIncidentPayload);
        }
      }
    }

    pendingRef.current = [...pendingRef.current, ...failed];
  }, [token, logout]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flush();
    }, FLUSH_INTERVAL_MS);
  }, [flush]);

  const sendReport = useCallback(
    async (payload: ReportIncidentPayload) => {
      if (!token) {
        pendingRef.current.push(payload);
        scheduleFlush();
        return;
      }

      try {
        const res = await reportIncident(token, payload);
        if (res.enforcement?.action) {
          setLastEnforcement(res.enforcement);
          if (res.enforcement.action === 'ban') {
            logout();
          }
        }
      } catch {
        pendingRef.current.push(payload);
        scheduleFlush();
      }
    },
    [token, logout, scheduleFlush],
  );

  // Keep attestation token fresh while authenticated.
  useEffect(() => {
    if (Platform.OS === 'web' || !token) return;
    refreshAttestation();
    const interval = setInterval(refreshAttestation, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [token]);

  // Subscribe to native security events.
  useEffect(() => {
    if (Platform.OS === 'web' || !token || !member) return;

    let cleanup = () => {};
    let cancelled = false;

    subscribeToSecurityEvents(
      (event: ScreenshotEvent) => {
        const groupId = activeGroupIdRef.current;
        if (!groupId) return;
        sendReport({ group_id: groupId, event_type: 'screenshot', timestamp: event.timestamp });
      },
      (event: RecordingStateEvent) => {
        const groupId = activeGroupIdRef.current;
        if (!groupId) return;
        sendReport({
          group_id: groupId,
          event_type: event.recording ? 'recording_start' : 'recording_stop',
          timestamp: event.timestamp,
        });
      },
    ).then((remove) => {
      if (!cancelled) cleanup = remove;
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [token, member, sendReport]);

  const value: SecurityContextValue = {
    setActiveGroupId: (groupId) => {
      activeGroupIdRef.current = groupId;
      if (token) flush();
    },
    lastEnforcement,
    clearLastEnforcement: () => setLastEnforcement(null),
  };

  return <SecurityContext.Provider value={value}>{children}</SecurityContext.Provider>;
}

export function useSecurity(): SecurityContextValue {
  const ctx = useContext(SecurityContext);
  if (!ctx) throw new Error('useSecurity must be used within SecurityProvider');
  return ctx;
}
