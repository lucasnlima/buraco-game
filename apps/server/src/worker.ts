import { clientMsgSchema, helloSchema, roomCodeSchema, type ServerMsg } from '@buraco/protocol';
import { handleApi } from './api';
import { Room, type RoomSnapshot } from './room';
import { D1Store, type Store } from './store';

export interface Env {
  ROOMS: DurableObjectNamespace;
  DB: D1Database;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const stub = (code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));

    const wsMatch = /^\/ws\/([^/]+)$/.exec(url.pathname);
    if (wsMatch) {
      const code = roomCodeSchema.safeParse(wsMatch[1]);
      if (!code.success) return new Response('Código inválido', { status: 400 });
      return stub(code.data).fetch(new Request(`https://do/ws?code=${code.data}`, req));
    }

    const api = await handleApi(req, {
      store: new D1Store(env.DB),
      allowedOrigin: env.ALLOWED_ORIGIN,
      turn:
        env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN
          ? { keyId: env.TURN_KEY_ID, apiToken: env.TURN_KEY_API_TOKEN }
          : undefined,
      rooms: {
        create: async (code) =>
          (await stub(code).fetch('https://do/init', { method: 'POST', body: code })).status ===
          200,
        exists: async (code) => (await stub(code).fetch('https://do/exists')).status === 200,
      },
    });
    return api ?? new Response('Buraco Online — servidor de jogo', { status: 200 });
  },
};

type Attachment = { playerId: string | null };

/** Uma instância por sala. Usa a API de WebSocket com hibernação. */
export class RoomDO implements DurableObject {
  private room: Room | null = null;
  private store: Store;

  constructor(
    private ctx: DurableObjectState,
    env: Env,
  ) {
    this.store = new D1Store(env.DB);
  }

  private async load(code?: string): Promise<Room | null> {
    if (this.room) return this.room;
    const snap = await this.ctx.storage.get<RoomSnapshot>('room');
    if (snap) {
      this.room = this.makeRoom(snap);
    } else if (code) {
      this.room = this.makeRoom({ code });
    }
    return this.room;
  }

  private makeRoom(init: RoomSnapshot | { code: string }): Room {
    return new Room(
      {
        now: () => Date.now(),
        store: this.store,
        send: (pid, msg) => this.sendTo(pid, msg),
      },
      init,
    );
  }

  private sockets(playerId: string): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((w) => (w.deserializeAttachment() as Attachment | null)?.playerId === playerId);
  }
  private sendTo(pid: string, msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const w of this.sockets(pid)) {
      try {
        w.send(data);
      } catch {
        /* socket morto */
      }
    }
  }

  private async persist(): Promise<void> {
    if (!this.room) return;
    await this.ctx.storage.put('room', this.room.snapshot());
    const next = this.room.tick();
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/init') {
      const existing = await this.ctx.storage.get('room');
      if (existing) return new Response('exists', { status: 409 });
      const code = await req.text();
      this.room = this.makeRoom({ code });
      await this.ctx.storage.put('room', this.room.snapshot());
      // sala vazia expira se ninguém entrar
      await this.ctx.storage.setAlarm(Date.now() + 10 * 60_000);
      return new Response('ok');
    }
    if (url.pathname === '/exists') {
      return new Response('', { status: (await this.ctx.storage.get('room')) ? 200 : 404 });
    }
    if (url.pathname === '/ws') {
      if (req.headers.get('upgrade') !== 'websocket')
        return new Response('Esperado WebSocket', { status: 426 });
      const room = await this.load();
      if (!room) return new Response('Sala não encontrada', { status: 404 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ playerId: null } satisfies Attachment);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 8192) return;
    const room = await this.load();
    if (!room) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment | null;

    if (!att?.playerId) {
      const hello = helloSchema.safeParse(parsed);
      if (!hello.success) {
        ws.send(
          JSON.stringify({ t: 'error', code: 'BAD_HELLO', message: 'Identificação inválida.' }),
        );
        return ws.close(4001, 'bad hello');
      }
      const p = await this.store.authenticate(hello.data.name, hello.data.token);
      if (!p) {
        ws.send(
          JSON.stringify({
            t: 'error',
            code: 'NAME_TAKEN',
            message: 'Esse nome já está em uso. Escolha outro.',
          }),
        );
        return ws.close(4002, 'name taken');
      }
      for (const old of this.sockets(p.id)) {
        old.serializeAttachment({ playerId: null });
        old.close(4000, 'replaced');
      }
      ws.serializeAttachment({ playerId: p.id } satisfies Attachment);
      const res = room.join(p.id, p.name);
      if (!res.ok) {
        ws.send(JSON.stringify({ t: 'error', code: res.code, message: res.message }));
        ws.serializeAttachment({ playerId: null });
        return ws.close(4003, res.code);
      }
      return this.persist();
    }

    const msg = clientMsgSchema.safeParse(parsed);
    if (!msg.success) {
      ws.send(JSON.stringify({ t: 'error', code: 'BAD_MESSAGE', message: 'Mensagem inválida.' }));
      return;
    }
    room.handle(att.playerId, msg.data);
    await this.persist();
  }

  private async onGone(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    const room = await this.load();
    if (!room || !att?.playerId) return;
    const stillHere = this.sockets(att.playerId).some(
      (w) => w !== ws && w.readyState === WebSocket.OPEN,
    );
    if (!stillHere) room.disconnect(att.playerId);
    await this.persist();
  }
  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onGone(ws);
  }
  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onGone(ws);
  }

  async alarm(): Promise<void> {
    const room = await this.load();
    if (!room) return;
    if (room.isEmpty && this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    await this.persist();
  }
}
