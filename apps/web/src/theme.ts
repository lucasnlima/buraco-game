import type { Card } from '@buraco/engine';
import { AVATAR_COUNT } from '@buraco/protocol';
import { cardCode } from '@buraco/engine';
import { assetUrl } from './assets';

/**
 * Tema visual. Imagens ficam em `public/assets/` (veja public/assets/README.md).
 * Cartas sem imagem (A, 2–10) são desenhadas em SVG no mesmo estilo.
 */
export type BackName = 'back' | 'back-blue' | 'back-wine';

export const theme = {
  useImages: true,
  basePath: '/assets',
  /** verso padrão: 'back' | 'back-blue' | 'back-wine' */
  back: 'back' as BackName,
};

/** Cartas que têm arte pronta (figuras e coringas). */
const IMAGE_CARDS = new Set(
  ['J', 'Q', 'K'].flatMap((r) => ['S', 'H', 'D', 'C'].map((s) => r + s)).concat(['JK1', 'JK2']),
);

export function cardImageUrl(c: Card): string | null {
  if (!theme.useImages) return null;
  let code = cardCode(c);
  if (c.rank === 0) code = `JK${((c.id - 104) % 2) + 1}`; // 4 coringas reutilizam 2 artes
  return IMAGE_CARDS.has(code) ? assetUrl(`${theme.basePath}/cards/${code}.webp`) : null;
}
export const backImageUrl = (back: BackName = theme.back): string | null =>
  theme.useImages ? assetUrl(`${theme.basePath}/cards/${back}.webp`) : null;

/** Mesa com dois baralhos: alterna os versos. Só visual — não revela qual carta é. */
export const deckBack = (i: number): BackName => (i % 2 === 0 ? 'back-blue' : 'back-wine');

/** Avatar escolhido pelo jogador; sem escolha, um fixo calculado a partir do nome. */
export const avatarUrl = (name: string, pick?: number | null): string => {
  const h = [...name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const n = pick ?? (h % AVATAR_COUNT) + 1;
  return assetUrl(`${theme.basePath}/avatars/${String(n).padStart(2, '0')}.webp`);
};

export const iconUrl = (name: string): string => assetUrl(`${theme.basePath}/icons/${name}.svg`);
export const badgeUrl = (name: string): string => assetUrl(`${theme.basePath}/badges/${name}.webp`);

const SUIT_FILE = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' } as const;
export const suitUrl = (suit: keyof typeof SUIT_FILE, fourColors: boolean): string =>
  assetUrl(`${theme.basePath}/suits/${fourColors ? '4-color/' : ''}${SUIT_FILE[suit]}.svg`);

export const SUIT_COLOR_2 = { S: '#14181c', C: '#14181c', H: '#c62828', D: '#c62828' } as const;
/** Modo 4 cores: cada naipe tem cor própria. */
export const SUIT_COLOR_4 = { S: '#14181c', H: '#c62828', D: '#1565c0', C: '#2e7d32' } as const;
