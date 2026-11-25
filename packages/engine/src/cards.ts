export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];

/** rank: 0 = coringa (joker), 1 = Ás, 2..10, 11 = J, 12 = Q, 13 = K */
export interface Card {
  /** 0..103 cartas normais (2 baralhos), 104..107 jokers */
  id: number;
  suit: Suit | null;
  rank: number;
}

export const isJoker = (c: Card): boolean => c.rank === 0;
/** Pode atuar como curinga: o 2 de qualquer naipe ou o joker. */
export const isWildCapable = (c: Card): boolean => c.rank === 2 || c.rank === 0;

export function createDeck(jokers: boolean): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < 2; d++) {
    SUITS.forEach((suit, si) => {
      for (let rank = 1; rank <= 13; rank++) {
        cards.push({ id: d * 52 + si * 13 + (rank - 1), suit, rank });
      }
    });
  }
  if (jokers) for (let j = 0; j < 4; j++) cards.push({ id: 104 + j, suit: null, rank: 0 });
  return cards;
}

export function rankLabel(rank: number): string {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  if (rank === 0) return 'JK';
  return String(rank);
}

/** Código de asset: "AS", "10H", "QC", "JK1"… (cópia 2 do baralho compartilha o mesmo asset). */
export function cardCode(c: Card): string {
  return c.rank === 0 ? `JK${c.id - 103}` : `${rankLabel(c.rank)}${c.suit}`;
}

/** Valor em pontos da carta (jogos baixados +, mão −). */
export function cardPoints(c: Card): number {
  if (c.rank === 0) return 20;
  if (c.rank === 1) return 15;
  if (c.rank === 2) return 10;
  if (c.rank <= 7) return 5;
  return 10;
}

export type RandomInt = (maxExclusive: number) => number;

/** Inteiro uniforme em [0, max) usando RNG criptograficamente seguro (sem viés de módulo). */
export const secureRandomInt: RandomInt = (max) => {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  let x: number;
  do {
    globalThis.crypto.getRandomValues(buf);
    x = buf[0]!;
  } while (x >= limit);
  return x % max;
};

/** Fisher–Yates; devolve uma cópia embaralhada. */
export function shuffle<T>(items: readonly T[], randInt: RandomInt = secureRandomInt): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
