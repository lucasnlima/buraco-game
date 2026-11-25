/**
 * Modo "Treinar contra o computador": o mesmo `Room` do servidor roda dentro do navegador,
 * com bots no lugar dos outros jogadores. Sem rede, sem ranking, sem voz.
 */
import { type Card, type Meld, resolveAddition, resolveNewMeld, teamOf } from '@buraco/engine';
import type { PlayerView } from '@buraco/engine';
import type { ClientMsg, GameAction, ServerMsg } from '@buraco/protocol';
import { Room } from '../../server/src/room';
import { MemoryStore } from '../../server/src/store-core';

const BOT_NAMES = ['Dona Maria', 'Seu Zé', 'Tia Lu'];
const HUMAN = 'you';

interface Bot {
  id: string;
  name: string;
  view: PlayerView | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Sequências candidatas na mão (Ás vale 1 e 14; curingas completam uma carta que falta). */
export function findRuns(hand: Card[], cfg: PlayerView['config']): Card[][] {
  const out: Card[][] = [];
  const wilds = hand.filter((c) => c.rank === 0 || c.rank === 2);
  for (const suit of ['S', 'H', 'D', 'C'] as const) {
    const cards = hand.filter((c) => c.suit === suit);
    const points: { v: number; c: Card }[] = [];
    for (const c of cards) {
      points.push({ v: c.rank, c });
      if (c.rank === 1) points.push({ v: 14, c });
    }
    points.sort((a, b) => a.v - b.v);
    let run: { v: number; c: Card }[] = [];
    const flush = () => {
      const uniq = [...new Map(run.map((p) => [p.c.id, p.c])).values()];
      if (uniq.length >= 3 && resolveNewMeld(uniq, cfg)) out.push(uniq);
      else if (uniq.length === 2) {
        const w = wilds.find((x) => x.suit !== suit || x.rank === 0);
        if (w && resolveNewMeld([...uniq, w], cfg)) out.push([...uniq, w]);
      }
      run = [];
    };
    for (const p of points) {
      const last = run[run.length - 1];
      if (last && p.v === last.v) continue;
      if (last && p.v !== last.v + 1) flush();
      run.push(p);
    }
    flush();
  }
  return out.sort((a, b) => b.length - a.length);
}

function usefulness(c: Card, hand: Card[], melds: Meld[], cfg: PlayerView['config']): number {
  if (c.rank === 0 || c.rank === 2) return 6;
  let s = 0;
  if (melds.some((m) => resolveAddition(m, [c], cfg))) s += 8;
  for (const o of hand) {
    if (o.id === c.id || o.suit !== c.suit) continue;
    const d = Math.abs(o.rank - c.rank);
    if (d === 1) s += 3;
    else if (d === 2) s += 2;
    if (o.rank === c.rank) s += 1;
  }
  return s;
}

export function startLocalGame(opts: {
  name: string;
  avatar?: number;
  bots: number;
  deliver: (m: ServerMsg) => void;
}) {
  const bots: Bot[] = Array.from({ length: opts.bots }, (_, i) => ({
    id: `bot-${i + 1}`,
    name: BOT_NAMES[i] ?? `Bot ${i + 1}`,
    view: null,
    timer: null,
  }));
  const byId = new Map(bots.map((b) => [b.id, b]));
  let stopped = false;

  const room: Room = new Room(
    {
      now: () => Date.now(),
      store: new MemoryStore(),
      send: (pid, msg) => {
        if (stopped) return;
        if (pid === HUMAN) return void queueMicrotask(() => !stopped && opts.deliver(msg));
        const bot = byId.get(pid);
        if (!bot) return;
        if (msg.t === 'state') {
          bot.view = msg.view;
          if (msg.view.status === 'playing' && msg.view.turn === msg.view.you) schedule(bot, 900);
        }
      },
    },
    { code: 'LOCAL' },
  );

  function act(bot: Bot, action: GameAction): boolean {
    const before = bot.view?.version;
    room.handle(bot.id, { t: 'game', action });
    return bot.view?.version !== before;
  }

  function schedule(bot: Bot, ms: number) {
    if (bot.timer || stopped) return;
    bot.timer = setTimeout(() => {
      bot.timer = null;
      if (!stopped) step(bot);
    }, ms);
  }

  function step(bot: Bot) {
    let v = bot.view;
    if (!v || v.status !== 'playing' || v.turn !== v.you) return;
    const myTeam = v.yourTeam;
    const teamMelds = () => bot.view!.melds.filter((m) => m.team === myTeam);

    if (v.phase === 'draw') {
      const top = v.discard[v.discard.length - 1];
      const wantsPile =
        !!top &&
        v.discard.length <= 5 &&
        (teamMelds().some((m) => resolveAddition(m, [top], v!.config)) ||
          findRuns([...v.myHand, top], v.config).some((r) => r.some((c) => c.id === top.id)));
      if (!(wantsPile && act(bot, { type: 'TAKE_DISCARD' }))) act(bot, { type: 'DRAW_STOCK' });
      return schedule(bot, 800);
    }

    for (let i = 0; i < 14; i++) {
      v = bot.view!;
      if (v.status !== 'playing' || v.phase !== 'play') return;
      let progress = false;
      outer: for (const m of teamMelds()) {
        for (const c of v.myHand) {
          if (
            resolveAddition(m, [c], v.config) &&
            act(bot, { type: 'ADD_TO_MELD', meldId: m.id, cardIds: [c.id] })
          ) {
            progress = true;
            break outer;
          }
        }
      }
      if (!progress) {
        for (const run of findRuns(v.myHand, v.config)) {
          if (act(bot, { type: 'MELD', cardIds: run.map((c) => c.id) })) {
            progress = true;
            break;
          }
        }
      }
      if (!progress) break;
    }

    v = bot.view!;
    if (v.status !== 'playing' || v.turn !== v.you || v.phase !== 'play') return;
    const melds = teamMelds();
    const ranked = [...v.myHand].sort(
      (a, b) =>
        usefulness(a, v!.myHand, melds, v!.config) - usefulness(b, v!.myHand, melds, v!.config) ||
        b.rank - a.rank,
    );
    for (const c of ranked) if (act(bot, { type: 'DISCARD', cardId: c.id })) return;
  }

  // Monta a sala: humano (anfitrião, lugar 1) + bots; inicia direto.
  room.join(HUMAN, opts.name, opts.avatar);
  for (const b of bots) room.join(b.id, b.name);
  room.handle(HUMAN, { t: 'start' });

  return {
    send: (m: ClientMsg) => room.handle(HUMAN, m),
    stop: () => {
      stopped = true;
      for (const b of bots) if (b.timer) clearTimeout(b.timer);
    },
    teamOf,
  };
}
