import { type Card, type Suit, isJoker, isWildCapable } from './cards';
import type { Config } from './config';

export interface Slot {
  card: Card;
  /** Posição na sequência: 1 (Ás baixo) … 13 (K) … 14 (Ás alto). */
  pos: number;
  /** true se esta carta está atuando como curinga (2 natural na posição 2 NÃO é curinga). */
  wild: boolean;
}

export interface Layout {
  kind: 'seq' | 'aces';
  suit: Suit | null;
  slots: Slot[];
}

export type CanastaType = 'suja' | 'limpa' | 'meia_real' | 'real';

const MAX_LEN = 14;

/**
 * Todas as formas válidas de organizar `cards` como sequência (mesmo naipe, consecutivas,
 * ≥3 cartas, ≤1 curinga, Ás baixo/alto sem "dar a volta"; dois Ases só como A…A).
 */
export function arrangements(cards: Card[]): Layout[] {
  if (cards.length < 3 || cards.length > MAX_LEN) return [];
  if (new Set(cards.map((c) => c.id)).size !== cards.length) return [];

  const found = new Map<string, Layout>();
  const wildChoices: (number | null)[] = [null];
  cards.forEach((c, i) => {
    if (isWildCapable(c)) wildChoices.push(i);
  });

  for (const w of wildChoices) {
    const naturals = cards.filter((_, i) => i !== w);
    if (naturals.some(isJoker)) continue;
    const suits = new Set(naturals.map((c) => c.suit));
    if (suits.size !== 1) continue;
    const suit = [...suits][0]!;
    const wild = w === null ? null : cards[w]!;

    const aces = naturals.filter((c) => c.rank === 1);
    const others = naturals.filter((c) => c.rank !== 1);
    if (aces.length > 2) continue;
    const aceOptions: number[][] =
      aces.length === 0 ? [[]] : aces.length === 1 ? [[1], [14]] : [[1, 14]];

    for (const acePos of aceOptions) {
      const placed = [
        ...others.map((card) => ({ card, pos: card.rank })),
        ...aces.map((card, i) => ({ card, pos: acePos[i]! })),
      ].sort((a, b) => a.pos - b.pos);
      if (new Set(placed.map((p) => p.pos)).size !== placed.length) continue;

      const min = placed[0]!.pos;
      const max = placed[placed.length - 1]!.pos;
      const holes = max - min + 1 - placed.length;

      let wildPositions: (number | null)[];
      if (!wild) {
        if (holes !== 0) continue;
        wildPositions = [null];
      } else if (holes === 1) {
        const taken = new Set(placed.map((p) => p.pos));
        let hole = min;
        while (taken.has(hole)) hole++;
        wildPositions = [hole];
      } else if (holes === 0) {
        wildPositions = [];
        if (max + 1 <= 14) wildPositions.push(max + 1);
        if (min - 1 >= 1) wildPositions.push(min - 1);
      } else continue;

      for (const wp of wildPositions) {
        const slots: Slot[] = placed.map((p) => ({ card: p.card, pos: p.pos, wild: false }));
        if (wild && wp !== null) {
          const asNatural = wild.rank === 2 && wild.suit === suit && wp === 2;
          slots.push({ card: wild, pos: wp, wild: !asNatural });
        }
        slots.sort((a, b) => a.pos - b.pos);
        const key = slots.map((s) => `${s.card.id}@${s.pos}`).join(',');
        if (!found.has(key)) found.set(key, { kind: 'seq', suit, slots });
      }
    }
  }
  // Preferência: sem curinga primeiro; depois curinga mais alto (extensão para cima).
  return [...found.values()].sort((a, b) => wildScore(b) - wildScore(a));
}

function wildScore(l: Layout): number {
  const w = l.slots.find((s) => s.wild);
  return w ? w.pos : 100;
}

export function aceTrinca(cards: Card[]): Layout | null {
  if (cards.length < 3 || cards.length > 8) return null;
  if (new Set(cards.map((c) => c.id)).size !== cards.length) return null;
  if (!cards.every((c) => c.rank === 1)) return null;
  return { kind: 'aces', suit: null, slots: cards.map((card) => ({ card, pos: 1, wild: false })) };
}

/** Escolhe uma organização; `wildPos` desambigua onde o curinga deve ficar. */
function pick(options: Layout[], wildPos?: number): Layout | null {
  if (options.length === 0) return null;
  if (wildPos !== undefined) {
    const m = options.find((l) => l.slots.some((s) => s.wild && s.pos === wildPos));
    if (m) return m;
  }
  return options[0]!;
}

/** Valida cartas como NOVO jogo. */
export function resolveNewMeld(cards: Card[], config: Config, wildPos?: number): Layout | null {
  const seq = pick(arrangements(cards), wildPos);
  if (seq) return seq;
  return config.acesTrinca ? aceTrinca(cards) : null;
}

/** Valida a adição de `extra` a um jogo existente. */
export function resolveAddition(
  layout: Layout,
  extra: Card[],
  config: Config,
  wildPos?: number,
): Layout | null {
  if (extra.length === 0) return null;
  const all = [...layout.slots.map((s) => s.card), ...extra];
  if (layout.kind === 'aces') return aceTrinca(all);
  let options = arrangements(all);
  if (!config.wildReposition) {
    const old = new Map(layout.slots.map((s) => [s.card.id, s.pos]));
    options = options.filter((l) =>
      l.slots.every((s) => !old.has(s.card.id) || old.get(s.card.id) === s.pos),
    );
  }
  return pick(options, wildPos);
}

export const wildCount = (l: Layout): number => l.slots.filter((s) => s.wild).length;

/** Tipo de canastra (null se < 7 cartas ou não for sequência). */
export function canastaType(l: Layout): CanastaType | null {
  if (l.kind !== 'seq' || l.slots.length < 7) return null;
  if (wildCount(l) > 0) return 'suja';
  if (l.slots.length === 14) return 'real';
  if (l.slots.length === 13 && l.slots[0]!.pos === 1) return 'meia_real';
  return 'limpa';
}
