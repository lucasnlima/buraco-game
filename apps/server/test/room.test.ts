import type { Card, PlayerView } from '@buraco/engine';
import { type ClientMsg, SEAT_HOLD_MS, type ServerMsg } from '@buraco/protocol';
import { describe, expect, it } from 'vitest';
import { handleApi } from '../src/api';
import { Room } from '../src/room';
import { MemoryStore } from '../src/store';

class Client {
  inbox: ServerMsg[] = [];
  view: PlayerView | null = null;
  constructor(
    public id: string,
    public name: string,
  ) {}
  last<T extends ServerMsg['t']>(t: T) {
    return [...this.inbox].reverse().find((m) => m.t === t) as
      Extract<ServerMsg, { t: T }> | undefined;
  }
}

function harness(snapshotTweak?: (r: Room) => void) {
  let now = 1_000_000;
  const store = new MemoryStore();
  const clients = new Map<string, Client>();
  const room: Room = new Room(
    {
      now: () => now,
      store,
      send: (id, msg) => {
        const c = clients.get(id)!;
        c.inbox.push(msg);
        if (msg.t === 'state') c.view = msg.view;
      },
    },
    { code: 'ABCDE' },
  );
  const join = (name: string) => {
    const c = new Client(`id-${name}`, name);
    clients.set(c.id, c);
    const r = room.join(c.id, name);
    return { c, r };
  };
  snapshotTweak?.(room);
  return {
    room,
    store,
    clients,
    join,
    send: (c: Client, m: ClientMsg) => room.handle(c.id, m),
    advance: (ms: number) => {
      now += ms;
      return room.tick();
    },
  };
}

/** Bot mínimo: compra do monte e descarta a carta comprada — leva a mão ao fim por monte esgotado. */
function playOut(h: ReturnType<typeof harness>, limit = 2000) {
  for (let i = 0; i < limit; i++) {
    const phase = h.room.s.phase;
    if (phase !== 'playing') return;
    const idx = h.room.s.match!.hand.turn;
    const c = h.clients.get(h.room.s.order[idx]!)!;
    const v = c.view!;
    if (v.phase === 'draw') h.send(c, { t: 'game', action: { type: 'DRAW_STOCK' } });
    else {
      const card: Card = c.view!.myHand[0]!;
      h.send(c, { t: 'game', action: { type: 'DISCARD', cardId: card.id } });
    }
  }
  throw new Error('não terminou');
}

describe('lobby', () => {
  it('primeiro a entrar é anfitrião; máx. 4; lugares únicos', () => {
    const h = harness();
    const a = h.join('Ana').c;
    h.join('Bia');
    h.join('Caio');
    h.join('Davi');
    expect(h.join('Edu').r).toMatchObject({ ok: false, code: 'ROOM_FULL' });
    expect(h.room.s.hostId).toBe(a.id);
    expect(new Set(h.room.s.players.map((p) => p.seat)).size).toBe(4);
    h.send(a, { t: 'seat', seat: 1 });
    expect(a.last('error')?.code).toBe('SEAT_TAKEN');
  });
  it('só o anfitrião muda regras e inicia; exige 2+ jogadores', () => {
    const h = harness();
    const a = h.join('Ana').c;
    const b = h.join('Bia').c;
    h.send(b, { t: 'config', config: { targetScore: 5000 } });
    expect(b.last('error')?.code).toBe('FORBIDDEN');
    h.send(a, { t: 'config', config: { targetScore: 5000, jokers: true } });
    expect(h.room.s.config).toMatchObject({ targetScore: 5000, jokers: true });
    h.send(b, { t: 'start' });
    expect(h.room.s.phase).toBe('lobby');
    const solo = harness();
    const s = solo.join('Solo').c;
    solo.send(s, { t: 'start' });
    expect(s.last('error')?.code).toBe('NOT_ENOUGH');
  });
});

describe('partida completa com 4 clientes', () => {
  it('joga até o fim da mão, cada um só vê a própria mão', () => {
    const h = harness();
    const ps = ['Ana', 'Bia', 'Caio', 'Davi'].map((n) => h.join(n).c);
    h.send(ps[0]!, { t: 'start' });
    expect(h.room.s.phase).toBe('playing');
    const hand = h.room.s.match!.hand;
    for (const [i, c] of ps.entries()) {
      expect(c.view!.you).toBe(i);
      expect(c.view!.myHand).toHaveLength(11);
      const json = JSON.stringify(c.view);
      // nenhuma carta das outras mãos / monte aparece na visão
      for (const other of hand.hands.flatMap((hh, j) => (j === i ? [] : hh)).concat(hand.stock)) {
        expect(json.includes(`"id":${other.id},`)).toBe(false);
      }
    }
    playOut(h);
    expect(h.room.s.phase).toBe('between');
    expect(ps[0]!.view!.result!.reason).toBe('exhausted');
    // próxima mão
    const dealer = h.room.s.match!.dealer;
    h.send(ps[2]!, { t: 'nextHand' });
    expect(h.room.s.phase).toBe('playing');
    expect(h.room.s.match!.handNumber).toBe(2);
    expect(h.room.s.match!.dealer).toBe((dealer + 1) % 4);
  });

  it('rejeita ação fora da vez e ação inválida', () => {
    const h = harness();
    const ps = ['Ana', 'Bia'].map((n) => h.join(n).c);
    h.send(ps[0]!, { t: 'start' });
    const turn = h.room.s.match!.hand.turn;
    const other = ps[1 - turn]!;
    h.send(other, { t: 'game', action: { type: 'DRAW_STOCK' } });
    expect(other.last('error')?.code).toBe('NOT_YOUR_TURN');
    h.send(ps[turn]!, { t: 'game', action: { type: 'DISCARD', cardId: 0 } });
    expect(ps[turn]!.last('error')?.code).toMatch(/MUST_DRAW|CARDS_NOT_IN_HAND/);
  });

  it('fim de partida grava o ranking (duplas: vitória para os dois parceiros)', async () => {
    const h = harness();
    const ps: Client[] = [];
    for (const n of ['Ana', 'Bia', 'Caio', 'Davi']) {
      const rec = (await h.store.authenticate(n, 'tok-' + n.padEnd(16, 'x')))!;
      const c = new Client(rec.id, n);
      h.clients.set(c.id, c);
      h.room.join(c.id, n);
      ps.push(c);
    }
    h.send(ps[0]!, { t: 'start' });
    // meta artificialmente baixa: qualquer mão encerra a partida
    (h.room.s.match!.config as { targetScore: number }).targetScore = -1_000_000;
    playOut(h);
    expect(h.room.s.phase).toBe('finished');
    await new Promise((r) => setTimeout(r, 0));
    const rows = await h.store.ranking('all');
    expect(rows).toHaveLength(4);
    const winnerTeam = h.room.s.match!.winners[0]!;
    const winnerNames = ps
      .filter((_, i) => i % 2 === winnerTeam)
      .map((p) => p.name)
      .sort();
    expect(
      rows
        .filter((r) => r.wins === 1)
        .map((r) => r.name)
        .sort(),
    ).toEqual(winnerNames);
    expect(rows.filter((r) => r.wins === 0)).toHaveLength(2);
    expect(rows.every((r) => r.games === 1)).toBe(true);
  });
});

describe('reconexão e desconexão', () => {
  it('reconecta na mesma partida com estado completo', () => {
    const h = harness();
    const [a, b] = ['Ana', 'Bia'].map((n) => h.join(n).c) as [Client, Client];
    h.send(a, { t: 'start' });
    h.room.disconnect(b.id);
    b.inbox.length = 0;
    expect(h.room.join(b.id, b.name).ok).toBe(true);
    expect(b.last('state')?.view.myHand).toHaveLength(11);
    expect(b.last('lobby')?.phase).toBe('playing');
  });
  it('desconhecido não entra em partida em andamento', () => {
    const h = harness();
    ['Ana', 'Bia'].forEach((n) => h.join(n));
    h.send(h.clients.get('id-Ana')!, { t: 'start' });
    expect(h.join('Intruso').r).toMatchObject({ ok: false, code: 'IN_PROGRESS' });
  });
  it('após 2 min o anfitrião decide esperar ou encerrar', () => {
    const h = harness();
    const [a, b] = ['Ana', 'Bia'].map((n) => h.join(n).c) as [Client, Client];
    h.send(a, { t: 'start' });
    h.room.disconnect(b.id);
    h.advance(SEAT_HOLD_MS - 1000);
    expect(h.room.s.pendingDecision).toBeNull();
    h.advance(2000);
    expect(h.room.s.pendingDecision).toBe(b.id);
    h.send(b, { t: 'decision', wait: false }); // não-anfitrião ignorado
    expect(h.room.s.pendingDecision).toBe(b.id);
    h.send(a, { t: 'decision', wait: true });
    expect(h.room.s.pendingDecision).toBeNull();
    expect(h.room.s.phase).toBe('playing');
    // outra rodada: encerra
    const h2 = harness();
    const [a2, b2] = ['Ana', 'Bia'].map((n) => h2.join(n).c) as [Client, Client];
    h2.send(a2, { t: 'start' });
    h2.room.disconnect(b2.id);
    h2.advance(SEAT_HOLD_MS + 1);
    h2.send(a2, { t: 'decision', wait: false });
    expect(h2.room.s.phase).toBe('abandoned');
  });
  it('no lobby, o lugar é liberado após 2 min e o anfitrião é transferido', () => {
    const h = harness();
    const [a, b] = ['Ana', 'Bia'].map((n) => h.join(n).c) as [Client, Client];
    h.room.disconnect(a.id);
    h.advance(SEAT_HOLD_MS + 1);
    expect(h.room.s.players.map((p) => p.id)).toEqual([b.id]);
    expect(h.room.s.hostId).toBe(b.id);
  });
  it('snapshot serializa e restaura a sala (persistência do DO)', () => {
    const h = harness();
    const [a] = ['Ana', 'Bia'].map((n) => h.join(n).c) as [Client];
    h.send(a, { t: 'start' });
    const snap = JSON.parse(JSON.stringify(h.room.snapshot()));
    const restored = new Room({ now: () => 0, store: h.store, send: () => {} }, snap);
    expect(restored.s.match!.hand.hands).toEqual(h.room.s.match!.hand.hands);
  });
});

describe('timer de turno', () => {
  it('estouro compra do monte e descarta; passa a vez', () => {
    const h = harness();
    const [a] = ['Ana', 'Bia'].map((n) => h.join(n).c) as [Client];
    h.send(a, { t: 'config', config: { turnTimer: 60 } });
    h.send(a, { t: 'start' });
    const first = h.room.s.match!.hand.turn;
    expect(h.room.s.deadline).not.toBeNull();
    h.advance(61_000);
    const hand = h.room.s.match!.hand;
    expect(hand.turn).toBe(1 - first);
    expect(hand.discard).toHaveLength(1);
  });
});

describe('chat, reações, voz, rate limit', () => {
  it('chat/reação chegam a todos; sinalização RTC só ao destinatário', () => {
    const h = harness();
    const [a, b, c] = ['Ana', 'Bia', 'Caio'].map((n) => h.join(n).c) as [Client, Client, Client];
    h.send(a, { t: 'chat', text: 'oi' });
    expect(c.last('chat')).toMatchObject({ text: 'oi', name: 'Ana' });
    h.send(a, { t: 'rtc', to: b.id, kind: 'offer', data: { sdp: 'x' } });
    expect(b.last('rtc')).toMatchObject({ from: a.id, kind: 'offer' });
    expect(c.last('rtc')).toBeUndefined();
    h.send(b, { t: 'voice', on: true });
    expect(a.last('lobby')!.players.find((p) => p.id === b.id)!.voice).toBe(true);
  });
  it('rate limit bloqueia rajadas', () => {
    const h = harness();
    const [a] = ['Ana', 'Bia'].map((n) => h.join(n).c) as [Client];
    for (let i = 0; i < 200; i++) h.send(a, { t: 'ping' });
    expect(a.last('error')?.code).toBe('RATE_LIMIT');
  });
});

describe('API REST', () => {
  const mk = () => {
    const store = new MemoryStore();
    const codes = new Set<string>();
    const deps = {
      store,
      rooms: {
        create: async (c: string) => (codes.has(c) ? false : (codes.add(c), true)),
        exists: async (c: string) => codes.has(c),
      },
    };
    const call = async (path: string, body?: unknown) => {
      const res = await handleApi(
        new Request(
          'http://x' + path,
          body ? { method: 'POST', body: JSON.stringify(body) } : undefined,
        ),
        deps,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { status: res!.status, json: (await res!.json()) as Record<string, any> };
    };
    return { call, store };
  };
  it('mesmo nome com outro token é recusado', async () => {
    const { call } = mk();
    expect((await call('/api/login', { name: 'Lucas', token: 'a'.repeat(20) })).status).toBe(200);
    expect((await call('/api/login', { name: 'lucas', token: 'a'.repeat(20) })).status).toBe(200);
    const r = await call('/api/login', { name: 'LUCAS', token: 'b'.repeat(20) });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('NAME_TAKEN');
  });
  it('valida nome e cria sala com código de 5 caracteres', async () => {
    const { call } = mk();
    expect((await call('/api/login', { name: 'x', token: 'a'.repeat(20) })).status).toBe(400);
    const r = await call('/api/rooms', { name: 'Lucas', token: 'a'.repeat(20) });
    expect(r.json.code).toMatch(/^[A-Z2-9]{5}$/);
    expect((await call('/api/rooms/' + r.json.code)).json.exists).toBe(true);
    expect((await call('/api/rooms/ZZZZZ')).json.exists).toBe(false);
  });
  it('ranking por período e perfil', async () => {
    const { call, store } = mk();
    const a = (await store.authenticate('Ana', 'a'.repeat(20)))!;
    const b = (await store.authenticate('Bia', 'b'.repeat(20)))!;
    const now = Date.now();
    const rec = (days: number, winner: string) => ({
      id: crypto.randomUUID(),
      roomCode: 'ABCDE',
      numPlayers: 2,
      targetScore: 3000,
      handsPlayed: 3,
      finishedAt: now - days * 86_400_000,
      players: [
        { playerId: a.id, team: 0, score: winner === a.id ? 3100 : 1000, won: winner === a.id },
        { playerId: b.id, team: 1, score: winner === b.id ? 3200 : 900, won: winner === b.id },
      ],
    });
    await store.recordMatch(rec(1, a.id));
    await store.recordMatch(rec(10, b.id));
    await store.recordMatch(rec(40, b.id));
    const all = (await call('/api/ranking?period=all')).json.rows;
    expect(all[0]).toMatchObject({ name: 'Bia', wins: 2, games: 3, bestScore: 3200 });
    const week = (await call('/api/ranking?period=week')).json.rows;
    expect(week).toHaveLength(2);
    expect(week[0]).toMatchObject({ name: 'Ana', wins: 1, games: 1 });
    const month = (await call('/api/ranking?period=month')).json.rows;
    expect(month.find((r: { name: string }) => r.name === 'Bia')).toMatchObject({
      wins: 1,
      games: 2,
    });
    const prof = (await call('/api/profile?name=Ana')).json;
    expect(prof.stats).toMatchObject({ wins: 1, games: 3, winRate: 33.3 });
    expect(prof.recent).toHaveLength(3);
    expect((await call('/api/profile?name=Zeca')).status).toBe(404);
  });
});
