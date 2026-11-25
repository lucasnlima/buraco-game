import type { ProfileData, RankingPeriod, RankingRow } from '@buraco/protocol';

export const SERVER_URL: string = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '';

export interface Identity {
  name: string;
  token: string;
}

const KEY = 'buraco.identity';

export function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}
export function saveIdentity(i: Identity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(i));
  } catch {
    /* modo privado */
  }
}
export function newToken(): string {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function wsUrl(code: string): string {
  const base = SERVER_URL || location.origin;
  return `${base.replace(/^http/, 'ws')}/ws/${code}`;
}

async function call<T>(
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(
    `${SERVER_URL}${path}`,
    body
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

export const api = {
  login: (i: Identity) => call<{ id: string; message?: string }>('/api/login', i),
  createRoom: (i: Identity) => call<{ code: string; message?: string }>('/api/rooms', i),
  roomExists: async (code: string) =>
    (await call<{ exists: boolean }>(`/api/rooms/${code}`)).data.exists,
  ranking: async (p: RankingPeriod) =>
    (await call<{ rows: RankingRow[] }>(`/api/ranking?period=${p}`)).data.rows ?? [],
  profile: (name: string) => call<ProfileData>(`/api/profile?name=${encodeURIComponent(name)}`),
  iceServers: async (i: Identity): Promise<RTCIceServer[]> => {
    try {
      const r = await call<{ iceServers: RTCIceServer[] }>('/api/turn', i);
      return r.data.iceServers ?? [{ urls: 'stun:stun.cloudflare.com:3478' }];
    } catch {
      return [{ urls: 'stun:stun.cloudflare.com:3478' }];
    }
  },
};
