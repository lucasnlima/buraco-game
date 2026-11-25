import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { arrangements, canastaType, resolveAddition, resolveNewMeld } from '../src/sequence';
import { Cards } from './helpers';

const seq = (codes: string) => arrangements(new Cards().many(codes))[0] ?? null;

describe('sequências válidas', () => {
  it('3 cartas consecutivas do mesmo naipe', () => {
    expect(seq('3H 4H 5H')).not.toBeNull();
  });
  it('aceita cartas fora de ordem', () => {
    const l = seq('5H 3H 4H')!;
    expect(l.slots.map((s) => s.pos)).toEqual([3, 4, 5]);
  });
  it('Ás baixo (A-2-3) e Ás alto (Q-K-A)', () => {
    expect(seq('AH 2H 3H')!.slots.map((s) => s.pos)).toEqual([1, 2, 3]);
    expect(seq('QH KH AH')!.slots.map((s) => s.pos)).toEqual([12, 13, 14]);
  });
  it('não faz a volta (K-A-2)', () => {
    expect(seq('KH AH 2H 3H')).toBeNull();
    expect(seq('QS KS AS 2S 3S')).toBeNull();
    // K-A-2 só é válido se o 2 for curinga cobrindo o Q (Q-K-A), nunca dando a volta
    const l = seq('KH AH 2H')!;
    expect(l.slots.map((s) => s.pos)).toEqual([12, 13, 14]);
    expect(l.slots[0]!.wild).toBe(true);
  });
  it('rejeita naipes misturados, duplicatas e menos de 3 cartas', () => {
    expect(seq('3H 4S 5H')).toBeNull();
    expect(seq('3H 3H 4H')).toBeNull();
    expect(seq('3H 4H')).toBeNull();
  });
  it('rejeita buraco sem curinga', () => {
    expect(seq('3H 4H 6H')).toBeNull();
  });
});

describe('curingas', () => {
  it('2 como curinga no buraco', () => {
    const l = seq('3H 5H 2S')!;
    expect(l.slots.find((s) => s.wild)).toMatchObject({ pos: 4 });
  });
  it('curinga na ponta', () => {
    const all = arrangements(new Cards().many('5H 6H 7H 2S'));
    const wildPositions = all.map((l) => l.slots.find((s) => s.wild)!.pos).sort();
    expect(wildPositions).toEqual([4, 8]);
  });
  it('joker é curinga', () => {
    expect(seq('5H 6H JK')).not.toBeNull();
  });
  it('no máximo 1 curinga por sequência', () => {
    expect(seq('5H 7H 2S 2D')).toBeNull();
    expect(seq('5H 6H 2S JK')).toBeNull();
  });
  it('2 natural na posição 2 não conta como curinga', () => {
    const l = seq('AH 2H 3H')!;
    expect(l.slots.every((s) => !s.wild)).toBe(true);
    expect(canastaType(seq('AH 2H 3H 4H 5H 6H 7H')!)).toBe('limpa');
  });
  it('2 natural + 1 curinga na mesma sequência', () => {
    const l = seq('AH 2H 3H 4H 2S')!;
    expect(l.slots.filter((s) => s.wild)).toHaveLength(1);
    // 2♥ natural continua natural
    expect(l.slots.find((s) => s.card.suit === 'H' && s.card.rank === 2)!.wild).toBe(false);
  });
  it('2 de outro naipe só serve como curinga', () => {
    const l = seq('AH 3H 4H 2S')!; // 2♠ cobre a posição 2
    expect(l.slots.find((s) => s.card.rank === 2)).toMatchObject({ wild: true, pos: 2 });
  });
  it('2 de outro naipe nunca é natural', () => {
    const l = seq('2S 3H 4H')!;
    expect(l.slots.find((s) => s.card.rank === 2)!.wild).toBe(true);
  });
  it('curinga não pode estar em jogo com Ás duplo + buraco inválido', () => {
    expect(seq('AH AH 2S')).toBeNull();
  });
});

describe('canastras', () => {
  it('limpa (7+ sem curinga)', () => {
    expect(canastaType(seq('4H 5H 6H 7H 8H 9H 10H')!)).toBe('limpa');
  });
  it('suja (com curinga)', () => {
    expect(canastaType(seq('4H 5H 6H 7H 8H 9H 2S')!)).toBe('suja');
  });
  it('6 cartas não é canastra', () => {
    expect(canastaType(seq('4H 5H 6H 7H 8H 9H')!)).toBeNull();
  });
  it('meia real A a K limpa (13)', () => {
    expect(canastaType(seq('AH 2H 3H 4H 5H 6H 7H 8H 9H 10H JH QH KH')!)).toBe('meia_real');
  });
  it('2 a K + Ás são as mesmas 13 cartas da meia real (Ás baixo)', () => {
    expect(canastaType(seq('2H 3H 4H 5H 6H 7H 8H 9H 10H JH QH KH AH')!)).toBe('meia_real');
  });
  it('13 cartas limpas sem o Ás (3 a Ás alto) é só limpa', () => {
    expect(canastaType(seq('3H 4H 5H 6H 7H 8H 9H 10H JH QH KH AH 2H')!)).toBe('meia_real');
    expect(canastaType(seq('4H 5H 6H 7H 8H 9H 10H JH QH KH AH')!)).toBe('limpa');
  });
  it('real A a A limpa (14)', () => {
    const l = seq('AH AH 2H 3H 4H 5H 6H 7H 8H 9H 10H JH QH KH')!;
    expect(canastaType(l)).toBe('real');
  });
  it('13 cartas A-K com curinga é suja', () => {
    expect(canastaType(seq('AH 3H 4H 5H 6H 7H 8H 9H 10H JH QH KH 2S')!)).toBe('suja');
  });
});

describe('adicionar a um jogo', () => {
  const cfg = DEFAULT_CONFIG;
  it('estende pela ponta', () => {
    const c = new Cards();
    const base = resolveNewMeld(c.many('4H 5H 6H'), cfg)!;
    const out = resolveAddition(base, c.many('7H'), cfg)!;
    expect(out.slots).toHaveLength(4);
  });
  it('rejeita carta que não encaixa', () => {
    const c = new Cards();
    const base = resolveNewMeld(c.many('4H 5H 6H'), cfg)!;
    expect(resolveAddition(base, c.many('9H'), cfg)).toBeNull();
    expect(resolveAddition(base, c.many('7S'), cfg)).toBeNull();
  });
  it('rejeita segundo curinga', () => {
    const c = new Cards();
    const base = resolveNewMeld(c.many('4H 6H 2S'), cfg)!;
    expect(resolveAddition(base, c.many('2D'), cfg)).toBeNull();
  });
  it('reposiciona o curinga quando a natural chega (padrão)', () => {
    const c = new Cards();
    const base = resolveNewMeld(c.many('4H 6H 2S'), cfg)!; // 2♠ em 5
    const out = resolveAddition(base, c.many('5H'), cfg)!;
    expect(out.slots.filter((s) => s.wild)).toHaveLength(1);
    expect(out.slots.find((s) => s.wild)!.pos).not.toBe(5);
  });
  it('sem reposicionamento, curinga não sai do lugar', () => {
    const c = new Cards();
    const cfg2 = { ...cfg, wildReposition: false };
    const base = resolveNewMeld(c.many('4H 6H 2S'), cfg2)!;
    expect(resolveAddition(base, c.many('5H'), cfg2)).toBeNull();
  });
  it('2 natural pode entrar numa sequência A-2-3 já com curinga', () => {
    const c = new Cards();
    const base = resolveNewMeld(c.many('AH 3H 2S'), cfg)!; // 2♠ curinga em 2
    const out = resolveAddition(base, c.many('2H'), cfg)!; // 2♥ natural passa a ocupar a 2
    expect(out.slots).toHaveLength(4);
    expect(out.slots.filter((s) => s.wild)).toHaveLength(1);
  });
});

describe('trinca de Ases (config)', () => {
  it('só com a config ligada', () => {
    const c = new Cards();
    const cards = c.many('AH AS AD');
    expect(resolveNewMeld(cards, DEFAULT_CONFIG)).toBeNull();
    expect(resolveNewMeld(cards, { ...DEFAULT_CONFIG, acesTrinca: true })?.kind).toBe('aces');
  });
  it('não aceita curinga na trinca', () => {
    const c = new Cards();
    expect(resolveNewMeld(c.many('AH AS 2D'), { ...DEFAULT_CONFIG, acesTrinca: true })).toBeNull();
  });
});
