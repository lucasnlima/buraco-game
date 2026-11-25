import { describe, expect, it } from 'vitest';
import type { Card } from '../src/cards';
import { type Action, type HandState, applyAction, applyTimeout, dealHand } from '../src/game';

function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n) };
}

const total = (st: HandState): number =>
  st.hands.reduce((t, h) => t + h.length, 0) +
  st.stock.length +
  st.discard.length +
  st.deads.reduce((t, d) => t + (d?.length ?? 0), 0) +
  st.melds.reduce((t, m) => t + m.slots.length, 0);

/** Bot: tenta baixar/adicionar de forma gulosa e aleatória; senão descarta. */
function botTurn(st: HandState, r: ReturnType<typeof rng>): HandState {
  const p = st.turn;
  const try_ = (s: HandState, a: Action): HandState => {
    const res = applyAction(s, p, a);
    return res.ok ? res.state : s;
  };
  let s = st;
  const wantDiscard = s.discard.length > 0 && r.next() < 0.25;
  s = try_(s, { type: wantDiscard ? 'TAKE_DISCARD' : 'DRAW_STOCK' });
  if (s.phase === 'draw') s = try_(s, { type: 'DRAW_STOCK' });
  if (s.status === 'ended') return s;

  for (let attempt = 0; attempt < 12 && s.status === 'playing'; attempt++) {
    const hand: Card[] = s.hands[p]!;
    if (hand.length < 2) break;
    const mine = s.melds.filter((m) => m.team === (s.numPlayers === 4 ? p % 2 : p));
    if (mine.length && r.next() < 0.7) {
      const m = mine[r.int(mine.length)]!;
      const c = hand[r.int(hand.length)]!;
      s = try_(s, { type: 'ADD_TO_MELD', meldId: m.id, cardIds: [c.id] });
      continue;
    }
    // tenta três cartas do mesmo naipe
    const bySuit = new Map<string, Card[]>();
    for (const c of hand) if (c.suit) bySuit.set(c.suit, [...(bySuit.get(c.suit) ?? []), c]);
    for (const cards of bySuit.values()) {
      if (cards.length < 3) continue;
      const sorted = cards.slice().sort((a, b) => a.rank - b.rank);
      for (let i = 0; i + 2 < sorted.length; i++) {
        const next = try_(s, { type: 'MELD', cardIds: sorted.slice(i, i + 3).map((c) => c.id) });
        if (next !== s) {
          s = next;
          break;
        }
      }
    }
  }
  if (s.status === 'ended') return s;
  const hand = s.hands[p]!;
  // tenta descartar cartas até uma ser aceita
  const order = hand.slice().sort(() => r.next() - 0.5);
  for (const c of order) {
    const res = applyAction(s, p, { type: 'DISCARD', cardId: c.id });
    if (res.ok) return res.state;
  }
  // nenhuma jogada de descarte válida: o timer resolve (não deve ocorrer)
  const t = applyTimeout(s);
  if (!t.ok) throw new Error(`jogador preso: ${t.code}`);
  return t.state;
}

describe('simulação de partidas completas com bots', () => {
  for (const n of [2, 3, 4]) {
    it(`${n} jogadores: 12 mãos terminam sem perder cartas nem travar`, () => {
      let ended = 0;
      let out = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const r = rng(seed * 7919 + n);
        let st = dealHand(n, { jokers: seed % 3 === 0 }, 0, r.int);
        const expected = seed % 3 === 0 ? 108 : 104;
        let turns = 0;
        while (st.status === 'playing') {
          st = botTurn(st, r);
          expect(total(st)).toBe(expected);
          if (++turns > 3000) throw new Error(`mão infinita (seed ${seed})`);
        }
        ended++;
        if (st.result!.reason === 'out') out++;
        // resultado coerente: soma dos componentes = total
        for (const t of st.result!.teams) {
          expect(t.total).toBe(
            t.meldPoints + t.canastaBonus + t.outBonus - t.deadPenalty - t.handPenalty,
          );
        }
      }
      expect(ended).toBe(12);
      expect(out).toBeGreaterThanOrEqual(0);
    });
  }
});
