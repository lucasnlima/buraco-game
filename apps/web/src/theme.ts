import type { Card } from '@buraco/engine';
import { cardCode } from '@buraco/engine';

/**
 * Tema das cartas. Para usar as imagens geradas (Gemini), coloque os arquivos em
 * `public/assets/cards/` (AS.png, 10H.png, QC.png, JK1.png, back.png…) e mude `useImages` para true.
 * Suit: S espadas, H copas, D ouros, C paus.
 */
export const theme = {
  useImages: false,
  imageExt: 'png' as 'png' | 'svg',
  basePath: '/assets/cards',
  /** mesa/fundo: troque por '/assets/table.jpg' quando existir */
  tableImage: null as string | null,
  logo: null as string | null,
};

export const cardImageUrl = (c: Card): string | null =>
  theme.useImages ? `${theme.basePath}/${cardCode(c)}.${theme.imageExt}` : null;
export const backImageUrl = (): string | null =>
  theme.useImages ? `${theme.basePath}/back.${theme.imageExt}` : null;

export const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;
export const SUIT_COLOR_2 = { S: '#14181c', C: '#14181c', H: '#c62828', D: '#c62828' } as const;
/** Modo 4 cores: cada naipe tem cor própria. */
export const SUIT_COLOR_4 = { S: '#14181c', H: '#c62828', D: '#1565c0', C: '#2e7d32' } as const;
