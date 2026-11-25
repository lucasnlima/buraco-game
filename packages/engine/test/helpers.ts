import { type Card, type Suit, SUITS } from '../src/cards';
import { type HandState, dealHand } from '../src/game';
import type { Config } from '../src/config';

const RANKS: Record<string, number> = { A: 1, J: 11, Q: 12, K: 13, JK: 0 };

/** Fábrica de cartas de teste: "10H", "AS", "2C", "JK". Cada chamada usa uma cópia livre do baralho. */
export class Cards {
  private used = new Set<number>();
  one(code: string): Card {
    const m = /^(A|J|Q|K|JK|\d+)([SHDC])?$/.exec(code);
    if (!m) throw new Error(`código inválido: ${code}`);
    const rank = RANKS[m[1]!] ?? Number(m[1]);
    if (rank === 0) {
      for (let id = 104; id < 108; id++) if (!this.used.has(id)) return this.mk(id, null, 0);
      throw new Error('sem jokers');
    }
    const suit = m[2] as Suit;
    const si = SUITS.indexOf(suit);
    for (let d = 0; d < 2; d++) {
      const id = d * 52 + si * 13 + (rank - 1);
      if (!this.used.has(id)) return this.mk(id, suit, rank);
    }
    // Cópias extras sintéticas (ids únicos ≥ 200) para montar cenários sem limite de baralho.
    return this.mk(200 + this.used.size, suit, rank);
  }
  many(codes: string): Card[] {
    return codes
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((c) => this.one(c));
  }
  private mk(id: number, suit: Suit | null, rank: number): Card {
    this.used.add(id);
    return { id, suit, rank };
  }
}

export interface Setup {
  numPlayers?: number;
  config?: Partial<Config>;
  hands?: Record<number, string>;
  stock?: string;
  discard?: string;
  deads?: Record<number, string>;
  turn?: number;
}

/** Monta um estado controlado (cartas não listadas ficam de fora). */
export function setup(s: Setup = {}): { st: HandState; cards: Cards } {
  const n = s.numPlayers ?? 2;
  const st = dealHand(n, s.config ?? {}, n - 1);
  const cards = new Cards();
  st.hands = st.hands.map((_, i) => cards.many(s.hands?.[i] ?? ''));
  st.stock = cards.many(s.stock ?? '4C 4C 9D 9D');
  st.discard = cards.many(s.discard ?? '');
  st.deads = st.deads.map((_, i) => cards.many(s.deads?.[i] ?? '5D 6D 7D'));
  st.turn = s.turn ?? 0;
  return { st, cards };
}

export const ids = (cs: Card[]): number[] => cs.map((c) => c.id);
