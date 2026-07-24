/**
 * Raven API client — single configured base URL.
 * All API calls go through apiRequest(); never construct URLs per-call.
 *
 * Base URL is injected via EXPO_PUBLIC_DOMAIN (set in the dev script from
 * REPLIT_DEV_DOMAIN; swap for your production domain when deploying).
 */

import { getAttestationHeader, refreshAttestation } from './attestation';

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string | null;
  } = {},
  allowAttestationRetry = true,
): Promise<T> {
  const { method = 'GET', body, token } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const attestation = getAttestationHeader();
  if (attestation) {
    headers['X-Raven-Attestation'] = attestation;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let json: { error?: string } = {};
    try {
      json = await res.json();
      message = json.error ?? message;
    } catch {
      // ignore
    }

    // If the backend rejected the request because of a missing/invalid attestation
    // token, try to refresh it once and retry the request.
    if (
      allowAttestationRetry &&
      res.status === 403 &&
      (json.error ?? '').toLowerCase().includes('attestation')
    ) {
      try {
        await refreshAttestation();
      } catch {
        // refreshAttestation logs its own warnings; fall through and throw.
      }
      return apiRequest(path, options, false);
    }

    throw new ApiError(res.status, message);
  }

  return res.json() as Promise<T>;
}

// ─── Enrollment ─────────────────────────────────────────────────────────────

export interface VerifyInviteResponse {
  valid: boolean;
  communityName: string;
  cellNumber: string;
}

export function verifyInvite(token: string) {
  return apiRequest<VerifyInviteResponse>('/enroll/verify-invite', {
    method: 'POST',
    body: { token },
  });
}

export function requestOtp(cellNumber: string) {
  return apiRequest<{ ok: boolean; dev_otp?: string }>('/enroll/request-otp', {
    method: 'POST',
    body: { cell_number: cellNumber },
  });
}

export interface VerifyOtpResponse {
  ok: boolean;
  token: string;
  member: { id: string; cellNumber: string; role: string; status: string };
}

export function verifyOtp(cellNumber: string, code: string, fullName?: string) {
  return apiRequest<VerifyOtpResponse>('/enroll/verify-otp', {
    method: 'POST',
    body: { cell_number: cellNumber, code, full_name: fullName },
  });
}

export function registerDevice(
  token: string,
  platform: string,
  deviceIdentifier: string,
) {
  return apiRequest<{ ok: boolean; device: object }>('/enroll/register-device', {
    method: 'POST',
    token,
    body: { platform, device_identifier: deviceIdentifier, public_key: null },
  });
}

// ─── Groups ─────────────────────────────────────────────────────────────────

export interface Group {
  id: string;
  name: string;
  createdAt: string;
  roleInGroup: string;
  joinedAt: string;
}

export function fetchGroups(token: string) {
  return apiRequest<{ groups: Group[] }>('/groups', { token });
}

export function fetchGroup(groupId: string, token: string) {
  return apiRequest<{ group: Group }>(`/groups/${groupId}`, { token });
}

export function createGroup(
  token: string,
  body: { name: string; member_ids?: string[] },
) {
  return apiRequest<{ group: Group }>('/groups', {
    method: 'POST',
    token,
    body,
  });
}

export interface SearchMember {
  id: string;
  fullName: string;
  cellNumber?: string;
  role?: string;
  status?: string;
  createdAt?: string;
}

export function searchMembers(token: string, query: string) {
  return apiRequest<{ members: SearchMember[] }>(
    `/members/search?q=${encodeURIComponent(query)}`,
    { token },
  );
}

export function fetchMember(token: string) {
  return apiRequest<{ member: SearchMember }>('/members/me', { token });
}

export interface GroupMember {
  id: string;
  fullName: string;
  cellNumber?: string;
  role: string;
  status: string;
  roleInGroup: string;
  joinedAt: string;
}

export function fetchGroupMembers(groupId: string, token: string) {
  return apiRequest<{ members: GroupMember[] }>(`/groups/${groupId}/members`, {
    token,
  });
}

export interface ChatMessage {
  id: string;
  groupId: string;
  senderId: string;
  senderName: string;
  content: string;
  contentType: string;
  createdAt: string;
}

export function fetchMessages(groupId: string, token: string, before?: string) {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  return apiRequest<{ messages: ChatMessage[]; hasMore: boolean }>(
    `/groups/${groupId}/messages${query}`,
    { token },
  );
}

// ─── Security / Incidents ───────────────────────────────────────────────────

export interface ReportIncidentResponse {
  ok: boolean;
  enforcement: {
    action: 'warn' | 'mute' | 'remove' | 'ban';
    mutedUntil?: string;
  };
}

export interface ReportIncidentPayload {
  group_id: string;
  event_type: 'screenshot' | 'recording_start' | 'recording_stop';
  timestamp: number;
}

export function reportIncident(token: string, payload: ReportIncidentPayload) {
  return apiRequest<ReportIncidentResponse>('/incidents/report', {
    method: 'POST',
    token,
    body: payload,
  });
}
