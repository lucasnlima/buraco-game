/** Servidor de desenvolvimento em Node (mesmo `Room`/`handleApi` do Worker, store em memória). */
import { createServer } from 'node:http';
import { clientMsgSchema, helloSchema, roomCodeSchema } from '@buraco/protocol';
import { type WebSocket, WebSocketServer } from 'ws';
import { handleApi } from './api';
import { Room } from './room';
import { MemoryStore } from './store';

const PORT = Number(process.env.PORT ?? 8787);
const store = new MemoryStore();
const rooms = new Map<string, Room>();
const sockets = new Map<string, Set<WebSocket>>(); // playerId -> sockets
const alarms = new Map<string, NodeJS.Timeout>();

function makeRoom(code: string): Room {
  const room: Room = new Room(
    {
      now: () => Date.now(),
      store,
      // DEV_FIXED_DECK=1: baralho sem embaralhar (testes E2E determinísticos). Nunca use em produção.
      randInt: process.env.DEV_FIXED_DECK ? (m) => m - 1 : undefined,
      send: (pid, msg) => {
        const data = JSON.stringify(msg);
        for (const ws of sockets.get(pid) ?? []) if (ws.readyState === ws.OPEN) ws.send(data);
      },
    },
    { code },
  );
  rooms.set(code, room);
  return room;
}

function schedule(code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  clearTimeout(alarms.get(code));
  const next = room.tick();
  if (next !== null)
    alarms.set(
      code,
      setTimeout(() => schedule(code), Math.max(250, next - Date.now())),
    );
}

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const url = `http://localhost:${PORT}${req.url}`;
  const request = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
  });
  const out = await handleApi(request, {
    store,
    rooms: {
      create: async (code) => (rooms.has(code) ? false : (makeRoom(code), true)),
      exists: async (code) => rooms.has(code),
    },
  });
  const r = out ?? new Response('Buraco dev server', { status: 200 });
  res.writeHead(
    r.status,
    Object.fromEntries(
      (r.headers as unknown as { entries(): Iterable<[string, string]> }).entries(),
    ),
  );
  res.end(Buffer.from(await r.arrayBuffer()));
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const m = /^\/ws\/([^/?]+)/.exec(req.url ?? '');
  const code = m && roomCodeSchema.safeParse(m[1]);
  if (!code || !code.success || !rooms.has(code.data)) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, code.data));
});

function onSocket(ws: WebSocket, code: string): void {
  let pid: string | null = null;
  ws.on('message', async (raw) => {
    const room = rooms.get(code);
    if (!room || raw.toString().length > 8192) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!pid) {
      const hello = helloSchema.safeParse(parsed);
      const p = hello.success ? await store.authenticate(hello.data.name, hello.data.token) : null;
      if (!p) {
        ws.send(
          JSON.stringify({
            t: 'error',
            code: 'NAME_TAKEN',
            message: 'Esse nome já está em uso. Escolha outro.',
          }),
        );
        return ws.close(4002);
      }
      for (const old of sockets.get(p.id) ?? []) old.close(4000, 'replaced');
      sockets.set(p.id, new Set([ws]));
      pid = p.id;
      const r = room.join(p.id, p.name, hello.data!.avatar);
      if (!r.ok) {
        ws.send(JSON.stringify({ t: 'error', code: r.code, message: r.message }));
        pid = null;
        return ws.close(4003);
      }
      return schedule(code);
    }
    const msg = clientMsgSchema.safeParse(parsed);
    if (!msg.success) return;
    room.handle(pid, msg.data);
    schedule(code);
  });
  ws.on('close', () => {
    if (!pid) return;
    const set = sockets.get(pid);
    set?.delete(ws);
    if (!set || set.size === 0) rooms.get(code)?.disconnect(pid);
    schedule(code);
  });
}

server.listen(PORT, () => console.log(`Buraco dev server em http://localhost:${PORT}`));
