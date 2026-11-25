import {
  type RankingPeriod,
  nameSchema,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  roomCodeSchema,
  tokenSchema,
} from '@buraco/protocol';
import { z } from 'zod';
import type { Store } from './store';

export interface RoomDirectory {
  /** Reserva uma sala nova e devolve o código. */
  create(code: string): Promise<boolean>;
  exists(code: string): Promise<boolean>;
}

export interface ApiDeps {
  store: Store;
  rooms: RoomDirectory;
  turn?: { keyId: string; apiToken: string };
  allowedOrigin?: string;
}

export function randomCode(): string {
  const buf = new Uint32Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(buf);
  return [...buf].map((n) => ROOM_CODE_ALPHABET[n % ROOM_CODE_ALPHABET.length]).join('');
}

const cors = (origin?: string): Record<string, string> => ({
  'access-control-allow-origin': origin ?? '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
});

const json = (data: unknown, status: number, origin?: string): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...cors(origin) },
  });

const loginSchema = z.object({ name: nameSchema, token: tokenSchema });

/** Rotas REST. Devolve null se o caminho não for /api/*. */
export async function handleApi(req: Request, deps: ApiDeps): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/api/')) return null;
  const o = deps.allowedOrigin;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(o) });

  try {
    if (url.pathname === '/api/health') return json({ ok: true }, 200, o);

    if (url.pathname === '/api/login' && req.method === 'POST') {
      const body = loginSchema.safeParse(await req.json());
      if (!body.success)
        return json({ error: 'INVALID', message: 'Nome ou token inválido.' }, 400, o);
      const p = await deps.store.authenticate(body.data.name, body.data.token);
      if (!p)
        return json(
          { error: 'NAME_TAKEN', message: 'Esse nome já está em uso. Escolha outro.' },
          409,
          o,
        );
      return json({ id: p.id, name: p.name }, 200, o);
    }

    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      const body = loginSchema.safeParse(await req.json());
      if (!body.success) return json({ error: 'INVALID', message: 'Dados inválidos.' }, 400, o);
      if (!(await deps.store.authenticate(body.data.name, body.data.token))) {
        return json(
          { error: 'NAME_TAKEN', message: 'Esse nome já está em uso. Escolha outro.' },
          409,
          o,
        );
      }
      for (let i = 0; i < 8; i++) {
        const code = randomCode();
        if (await deps.rooms.create(code)) return json({ code }, 200, o);
      }
      return json(
        { error: 'BUSY', message: 'Não foi possível criar a sala. Tente de novo.' },
        503,
        o,
      );
    }

    const roomMatch = /^\/api\/rooms\/([^/]+)$/.exec(url.pathname);
    if (roomMatch && req.method === 'GET') {
      const code = roomCodeSchema.safeParse(decodeURIComponent(roomMatch[1]!));
      if (!code.success) return json({ exists: false }, 200, o);
      return json({ exists: await deps.rooms.exists(code.data) }, 200, o);
    }

    if (url.pathname === '/api/ranking' && req.method === 'GET') {
      const period = (['all', 'week', 'month'] as const).includes(
        url.searchParams.get('period') as RankingPeriod,
      )
        ? (url.searchParams.get('period') as RankingPeriod)
        : 'all';
      return json({ period, rows: await deps.store.ranking(period, 50) }, 200, o);
    }

    if (url.pathname === '/api/profile' && req.method === 'GET') {
      const name = nameSchema.safeParse(url.searchParams.get('name') ?? '');
      if (!name.success) return json({ error: 'INVALID' }, 400, o);
      const prof = await deps.store.profile(name.data);
      return prof ? json(prof, 200, o) : json({ error: 'NOT_FOUND' }, 404, o);
    }

    if (url.pathname === '/api/turn' && req.method === 'POST') {
      const body = loginSchema.safeParse(await req.json());
      if (!body.success) return json({ error: 'INVALID' }, 400, o);
      if (!(await deps.store.authenticate(body.data.name, body.data.token)))
        return json({ error: 'FORBIDDEN' }, 403, o);
      const iceServers: unknown[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
      if (deps.turn) {
        // Credenciais temporárias (a chave da API nunca vai ao cliente).
        const r = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${deps.turn.keyId}/credentials/generate`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${deps.turn.apiToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ ttl: 86400 }),
          },
        );
        if (r.ok) {
          const data = (await r.json()) as { iceServers?: unknown };
          if (data.iceServers)
            iceServers.push(
              ...(Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers]),
            );
        }
      }
      return json({ iceServers }, 200, o);
    }
    return json({ error: 'NOT_FOUND' }, 404, o);
  } catch {
    return json({ error: 'BAD_REQUEST' }, 400, o);
  }
}
