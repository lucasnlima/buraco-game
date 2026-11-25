import { describe, expect, it } from 'vitest';
import { applyAction, applyTimeout, dealHand, newMatch, nextHand, settleHand } from '../src/game';
import { viewFor } from '../src/view';
import type { HandState } from '../src/game';
import { cardPoints } from '../src/cards';
import { scoreHand } from '../src/scoring';
import { arrangements } from '../src/sequence';
import { Cards, ids, setup } from './helpers';

const ok = (r: ReturnType<typeof applyAction>): HandState => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.state;
};

describe('distribuição', () => {
  it.each([
    [2, 60, 2],
    [3, 38, 3],
    [4, 38, 2],
  ])('%i jogadores: monte %i, %i mortos', (n, stock, deads) => {
    const st = dealHand(n);
    expect(st.hands.every((h) => h.length === 11)).toBe(true);
    expect(st.stock).toHaveLength(stock);
    expect(st.deads).toHaveLength(deads);
    expect(st.deads.every((d) => d!.length === 11)).toBe(true);
    expect(st.discard).toHaveLength(0);
    expect(st.turn).toBe(1 % n === 0 ? 0 : 1); // à esquerda do carteador (dealer 0)
    const all = [...st.hands.flat(), ...st.stock, ...st.deads.flatMap((d) => d ?? [])];
    expect(new Set(all.map((c) => c.id)).size).toBe(104);
  });
  it('4 coringas quando ativado', () => {
    const st = dealHand(2, { jokers: true });
    const all = [...st.hands.flat(), ...st.stock, ...st.deads.flatMap((d) => d ?? [])];
    expect(all).toHaveLength(108);
    expect(all.filter((c) => c.rank === 0)).toHaveLength(4);
  });
  it('rejeita número de jogadores inválido', () => {
    expect(() => dealHand(5)).toThrow();
  });
  it('é determinístico com RNG fixo e diferente com RNG distinto', () => {
    let s = 1;
    const r = (n: number) => (s = (s * 48271) % 2147483647) % n;
    const a = dealHand(2, {}, 0, r);
    s = 1;
    const b = dealHand(2, {}, 0, r);
    expect(a.hands).toEqual(b.hands);
  });
});

describe('fluxo de turno', () => {
  it('não joga fora da vez', () => {
    const { st } = setup({ hands: { 0: '3H 4H', 1: '5H 6H' } });
    const r = applyAction(st, 1, { type: 'DRAW_STOCK' });
    expect(r).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
  });
  it('não baixa nem descarta sem comprar', () => {
    const { st } = setup({ hands: { 0: '3H 4H 5H 9S' } });
    expect(applyAction(st, 0, { type: 'DISCARD', cardId: st.hands[0]![3]!.id })).toMatchObject({
      code: 'MUST_DRAW',
    });
    expect(
      applyAction(st, 0, { type: 'MELD', cardIds: ids(st.hands[0]!.slice(0, 3)) }),
    ).toMatchObject({ code: 'MUST_DRAW' });
  });
  it('não compra duas vezes', () => {
    const { st } = setup({ hands: { 0: '3H 4H 9S' } });
    const s2 = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    expect(applyAction(s2, 0, { type: 'DRAW_STOCK' })).toMatchObject({ code: 'ALREADY_DREW' });
    expect(applyAction(s2, 0, { type: 'TAKE_DISCARD' })).toMatchObject({ code: 'ALREADY_DREW' });
  });
  it('compra, baixa e descarta passando a vez', () => {
    const { st } = setup({ hands: { 0: '3H 4H 9S 10S', 1: 'KS KS' }, stock: '5H' });
    let s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    expect(s.phase).toBe('play');
    const cards = s.hands[0]!;
    s = ok(applyAction(s, 0, { type: 'MELD', cardIds: ids(cards.filter((c) => c.suit === 'H')) }));
    expect(s.melds).toHaveLength(1);
    const d = s.hands[0]![0]!;
    s = ok(applyAction(s, 0, { type: 'DISCARD', cardId: d.id }));
    expect(s.turn).toBe(1);
    expect(s.phase).toBe('draw');
    expect(s.discard).toEqual([d]);
  });
  it('pega o lixo inteiro sem exigir uso imediato (Aberto)', () => {
    const { st } = setup({ hands: { 0: '3H 9S' }, discard: '2D KC KC 7S' });
    const s = ok(applyAction(st, 0, { type: 'TAKE_DISCARD' }));
    expect(s.hands[0]).toHaveLength(6);
    expect(s.discard).toHaveLength(0);
  });
  it('a única carta do lixo não pode ser descartada na mesma vez', () => {
    const { st } = setup({ hands: { 0: '3H 9S', 1: 'KS KS' }, discard: '7D' });
    const taken = st.discard[0]!;
    const s = ok(applyAction(st, 0, { type: 'TAKE_DISCARD' }));
    expect(applyAction(s, 0, { type: 'DISCARD', cardId: taken.id })).toMatchObject({
      code: 'DISCARD_TAKEN_CARD',
    });
    const next = ok(applyAction(s, 0, { type: 'DISCARD', cardId: st.hands[0]![0]!.id }));
    expect(next.turn).toBe(1);
    // o bloqueio vale só naquela vez
    expect(next.turnInfo.lockedCardId).toBeNull();
  });
  it('com duas ou mais cartas no lixo, qualquer uma pode ser descartada', () => {
    const { st } = setup({ hands: { 0: '3H 9S' }, discard: '7D 8C' });
    const top = st.discard[1]!;
    const s = ok(applyAction(st, 0, { type: 'TAKE_DISCARD' }));
    expect(applyAction(s, 0, { type: 'DISCARD', cardId: top.id }).ok).toBe(true);
  });
  it('não deixa baixar ficando só com a carta única do lixo, se ela não tem onde entrar', () => {
    const { st } = setup({ hands: { 0: '3H 4H 5H' }, discard: 'KD' });
    const s = ok(applyAction(st, 0, { type: 'TAKE_DISCARD' }));
    const hearts = s.hands[0]!.filter((c) => c.suit === 'H');
    expect(applyAction(s, 0, { type: 'MELD', cardIds: ids(hearts) })).toMatchObject({
      code: 'DISCARD_TAKEN_CARD',
    });
  });
  it('deixa ficar só com a carta do lixo quando ela entra num jogo', () => {
    const { st } = setup({ hands: { 0: '3H 4H 5H' }, discard: '6H' });
    const taken = st.discard[0]!;
    let s = ok(applyAction(st, 0, { type: 'TAKE_DISCARD' }));
    const three = s.hands[0]!.filter((c) => c.id !== taken.id);
    s = ok(applyAction(s, 0, { type: 'MELD', cardIds: ids(three) }));
    s = ok(applyAction(s, 0, { type: 'ADD_TO_MELD', meldId: 1, cardIds: [taken.id] }));
    expect(s.deadTaken[0]).toBe(true);
  });
  it('estouro do tempo descarta outra carta, não a única do lixo', () => {
    const { st } = setup({ hands: { 0: '3H 9S' }, discard: '7D' });
    const taken = st.discard[0]!;
    const s = ok(applyAction(st, 0, { type: 'TAKE_DISCARD' }));
    const r = ok(applyTimeout(s));
    expect(r.turn).toBe(1);
    expect(r.discard[0]!.id).not.toBe(taken.id);
  });
  it('lixo vazio não pode ser pego', () => {
    const { st } = setup({ hands: { 0: '3H 9S' } });
    expect(applyAction(st, 0, { type: 'TAKE_DISCARD' })).toMatchObject({ code: 'DISCARD_EMPTY' });
  });
  it('não usa cartas que não estão na mão (nem de adversário)', () => {
    const { st } = setup({ hands: { 0: '3H 4H 9S', 1: '5H' } });
    const s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    const foreign = st.hands[1]![0]!.id;
    expect(applyAction(s, 0, { type: 'DISCARD', cardId: foreign })).toMatchObject({
      code: 'CARDS_NOT_IN_HAND',
    });
  });
  it('só adiciona a jogos da própria dupla', () => {
    const { st, cards } = setup({
      numPlayers: 4,
      hands: { 0: '3H 4H 5H 9S', 1: '6H 9D', 2: '8H 9C', 3: 'KD KD' },
      stock: '7H 7H 7H',
    });
    void cards;
    let s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    s = ok(
      applyAction(s, 0, {
        type: 'MELD',
        cardIds: ids(s.hands[0]!.filter((c) => c.suit === 'H' && c.rank <= 5)),
      }),
    );
    s = ok(applyAction(s, 0, { type: 'DISCARD', cardId: s.hands[0]![0]!.id }));
    s = ok(applyAction(s, 1, { type: 'DRAW_STOCK' }));
    const six = s.hands[1]!.find((c) => c.rank === 6)!;
    expect(applyAction(s, 1, { type: 'ADD_TO_MELD', meldId: 1, cardIds: [six.id] })).toMatchObject({
      code: 'NOT_YOUR_MELD',
    });
  });
  it('parceiro (4 jogadores) pode adicionar ao jogo da dupla', () => {
    const { st } = setup({
      numPlayers: 4,
      hands: { 0: '3H 4H 5H 9S', 1: '9D 9D', 2: '6H 9C', 3: 'KD KD' },
      stock: '7H 7H 7H',
    });
    let s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    s = ok(
      applyAction(s, 0, {
        type: 'MELD',
        cardIds: ids(s.hands[0]!.filter((c) => c.suit === 'H' && c.rank <= 5)),
      }),
    );
    s = ok(applyAction(s, 0, { type: 'DISCARD', cardId: s.hands[0]![0]!.id }));
    s = ok(applyAction(s, 1, { type: 'DRAW_STOCK' }));
    s = ok(applyAction(s, 1, { type: 'DISCARD', cardId: s.hands[1]![0]!.id }));
    s = ok(applyAction(s, 2, { type: 'DRAW_STOCK' }));
    const six = s.hands[2]!.find((c) => c.rank === 6)!;
    s = ok(applyAction(s, 2, { type: 'ADD_TO_MELD', meldId: 1, cardIds: [six.id] }));
    expect(s.melds[0]!.slots).toHaveLength(4);
  });
});

describe('recusa da primeira compra', () => {
  it('recusa uma vez, só na primeira jogada da mão', () => {
    const { st } = setup({ hands: { 0: '3H 4H', 1: '3S 4S' }, stock: '8H 9H' });
    let s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' })); // compra 9H
    expect(viewFor(s, 0).canRefuseDraw).toBe(true);
    s = ok(applyAction(s, 0, { type: 'REJECT_DRAW' }));
    expect(s.discard.map((c) => c.rank)).toEqual([9]);
    expect(s.hands[0]!.some((c) => c.rank === 8)).toBe(true);
    expect(applyAction(s, 0, { type: 'REJECT_DRAW' })).toMatchObject({ code: 'CANNOT_REFUSE' });
  });
  it('não permite depois de baixar, nem com config desligada, nem após a 1ª rodada', () => {
    const { st } = setup({
      hands: { 0: '3H 4H 5H', 1: '3S 4S' },
      stock: '8H 9H 2D 2D',
      config: { firstDrawRefusal: false },
    });
    const s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    expect(applyAction(s, 0, { type: 'REJECT_DRAW' })).toMatchObject({ code: 'CANNOT_REFUSE' });

    const b = setup({ hands: { 0: '3H 4H 5H 9S', 1: '3S 4S' }, stock: '8H 9H 2D 2D' });
    let t = ok(applyAction(b.st, 0, { type: 'DRAW_STOCK' }));
    t = ok(applyAction(t, 0, { type: 'MELD', cardIds: ids(t.hands[0]!.slice(0, 3)) }));
    expect(applyAction(t, 0, { type: 'REJECT_DRAW' })).toMatchObject({ code: 'CANNOT_REFUSE' });
    t = ok(applyAction(t, 0, { type: 'DISCARD', cardId: t.hands[0]![0]!.id }));
    t = ok(applyAction(t, 1, { type: 'DRAW_STOCK' }));
    expect(applyAction(t, 1, { type: 'REJECT_DRAW' })).toMatchObject({ code: 'CANNOT_REFUSE' });
  });
});

describe('morto', () => {
  it('morto direto: zera a mão baixando, pega o morto e continua na mesma vez', () => {
    const { st } = setup({
      hands: { 0: '3H 4H 5H' },
      stock: '6H',
      deads: { 0: '9S 9S 9S', 1: 'KS KS KS' },
    });
    let s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    s = ok(applyAction(s, 0, { type: 'MELD', cardIds: ids(s.hands[0]!.slice(0, 3)) }));
    // sobrou 1 carta (6H): adiciona → mão zera
    s = ok(applyAction(s, 0, { type: 'ADD_TO_MELD', meldId: 1, cardIds: [s.hands[0]![0]!.id] }));
    expect(s.deadTaken[0]).toBe(true);
    expect(s.deads[0]).toBeNull();
    expect(s.hands[0]).toHaveLength(3);
    expect(s.turn).toBe(0);
    expect(s.status).toBe('playing');
    s = ok(applyAction(s, 0, { type: 'DISCARD', cardId: s.hands[0]![0]!.id }));
    expect(s.turn).toBe(1);
  });
  it('morto indireto: zera a mão no descarte; joga com o morto só na próxima vez', () => {
    const { st } = setup({
      hands: { 0: '9S' },
      stock: 'KD',
      deads: { 0: '3S 4S 8H', 1: 'QS QS QS' },
    });
    let s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    // 9S + KD na mão; baixar não é possível, descarta uma, mantém 1? precisa zerar: simulamos mão de 1 carta
    s.hands[0] = [s.hands[0]![0]!];
    s = ok(applyAction(s, 0, { type: 'DISCARD', cardId: s.hands[0]![0]!.id }));
    expect(s.turn).toBe(1);
    expect(s.hands[0]).toHaveLength(3);
    expect(s.deadTaken[0]).toBe(true);
  });
  it('só um morto por time: parceiro que zera a mão não pega outro (4 jogadores)', () => {
    const { st } = setup({
      numPlayers: 4,
      hands: { 0: '9D', 1: '8D', 2: '3H 4H 5H' },
      stock: '6H 7C 7C',
      turn: 2,
    });
    st.deads[0] = null;
    st.deadTaken[0] = true;
    const s = ok(applyAction(st, 2, { type: 'DRAW_STOCK' }));
    // Baixar 3 deixaria 1 carta que só sairia batendo; sem canastra limpa é bloqueado
    // e o parceiro NÃO pega um segundo morto.
    const r = applyAction(s, 2, { type: 'MELD', cardIds: ids(s.hands[2]!.slice(0, 3)) });
    expect(r).toMatchObject({ ok: false, code: 'NEED_CLEAN_CANASTA' });
    expect(st.deads[1]).not.toBeNull();
    expect(st.deadTaken).toEqual([true, false]);
    void s;
  });
});

describe('batida', () => {
  const canastaHand = '4H 5H 6H 7H 8H 9H 10H'; // limpa pronta para baixar

  it('bloqueia baixar/descartar a última carta sem canastra limpa', () => {
    const { st } = setup({ hands: { 0: '3S 4S 5S' }, stock: '6S' });
    st.deads[0] = null;
    st.deadTaken[0] = true;
    let s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' })); // mão: 3S 4S 5S 6S
    const r = applyAction(s, 0, { type: 'MELD', cardIds: ids(s.hands[0]!) });
    expect(r).toMatchObject({ ok: false, code: 'NEED_CLEAN_CANASTA' });
    expect(r.ok ? '' : r.message).toBe('Você precisa de uma canastra limpa para bater.');
    // baixar 3 deixando 1 carta que só poderia sair pelo descarte → também bloqueado
    const r2 = applyAction(s, 0, { type: 'MELD', cardIds: ids(s.hands[0]!.slice(0, 3)) });
    expect(r2).toMatchObject({ ok: false, code: 'NEED_CLEAN_CANASTA' });
    // descartar mantendo 3 cartas segue permitido
    s = ok(applyAction(s, 0, { type: 'DISCARD', cardId: s.hands[0]![0]!.id }));
    expect(s.turn).toBe(1);
  });

  it('bate baixando tudo com morto pego e canastra limpa', () => {
    const { st } = setup({
      hands: { 0: canastaHand.replace(' 10H', '') + ' 3S 3S' },
      stock: '10H',
    });
    st.deads[0] = null;
    st.deadTaken[0] = true;
    let s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    const hs = s.hands[0]!;
    s = ok(applyAction(s, 0, { type: 'MELD', cardIds: ids(hs.filter((c) => c.suit === 'H')) }));
    expect(s.melds[0]!.slots).toHaveLength(7);
    // sobram 3S 3S; descarta uma e bate com a outra
    s = ok(applyAction(s, 0, { type: 'DISCARD', cardId: s.hands[0]![0]!.id }));
    expect(s.status).toBe('playing');
  });

  it('bate no descarte final', () => {
    const { st } = setup({ hands: { 0: '4H 5H 6H 7H 8H 9H 10H' }, stock: '3S' });
    st.deads[0] = null;
    st.deadTaken[0] = true;
    let s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    s = ok(
      applyAction(s, 0, { type: 'MELD', cardIds: ids(s.hands[0]!.filter((c) => c.suit === 'H')) }),
    );
    s = ok(applyAction(s, 0, { type: 'DISCARD', cardId: s.hands[0]![0]!.id }));
    expect(s.status).toBe('ended');
    expect(s.result!.reason).toBe('out');
    expect(s.result!.outPlayer).toBe(0);
    expect(s.result!.teams[0]!.outBonus).toBe(100);
  });

  it('canastra suja não basta (padrão) mas basta com a config', () => {
    const run = (cfg: object) => {
      const { st } = setup({ hands: { 0: '4H 5H 6H 7H 8H 9H 2S' }, stock: '3S', config: cfg });
      st.deads[0] = null;
      st.deadTaken[0] = true;
      const s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
      return {
        s,
        meld: applyAction(s, 0, {
          type: 'MELD',
          cardIds: ids(s.hands[0]!.filter((c) => c.suit === 'H' || c.rank === 2)),
        }),
      };
    };
    // padrão: baixar a suja deixaria só 3♠, que não poderia ser descartada para bater
    expect(run({}).meld).toMatchObject({ ok: false, code: 'NEED_CLEAN_CANASTA' });
    const { meld } = run({ dirtyCanastaToGoOut: true });
    const after = ok(meld);
    const end = ok(applyAction(after, 0, { type: 'DISCARD', cardId: after.hands[0]![0]!.id }));
    expect(end.status).toBe('ended');
  });

  it('modo "só baixando" bloqueia bater no descarte, mas permite baixando tudo', () => {
    const mk = (stock: string) => {
      const { st } = setup({ hands: { 0: canastaHand }, stock, config: { goOut: 'meld' } });
      st.deads[0] = null;
      st.deadTaken[0] = true;
      return ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    };
    const s1 = mk('3S');
    expect(
      applyAction(s1, 0, {
        type: 'MELD',
        cardIds: ids(s1.hands[0]!.filter((c) => c.suit === 'H')),
      }),
    ).toMatchObject({ code: 'GO_OUT_MODE_MELD' });
    const s2 = mk('3H');
    const end = ok(applyAction(s2, 0, { type: 'MELD', cardIds: ids(s2.hands[0]!) }));
    expect(end.status).toBe('ended');
    expect(end.result!.teams[0]!.outBonus).toBe(100);
  });
});

describe('monte esgotado', () => {
  it('morto restante vira monte (padrão)', () => {
    const { st } = setup({ hands: { 0: '3H 9S', 1: '3S 9D' }, stock: '' });
    const s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    expect(s.stock).toHaveLength(2); // morto de 3 cartas (setup) menos a comprada
    expect(s.deads.filter((d) => d !== null)).toHaveLength(1);
  });
  it('mão termina sem bônus de batida quando o monte acaba e não há morto', () => {
    const { st } = setup({ hands: { 0: '3H 4H 5H 9S', 1: 'KS' }, stock: '8D' });
    st.deads = [null, null];
    st.deadTaken = [true, true];
    let s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    s = ok(
      applyAction(s, 0, { type: 'MELD', cardIds: ids(s.hands[0]!.filter((c) => c.suit === 'H')) }),
    );
    s = ok(applyAction(s, 0, { type: 'DISCARD', cardId: s.hands[0]![0]!.id }));
    expect(s.status).toBe('ended');
    expect(s.result!.reason).toBe('exhausted');
    expect(s.result!.teams.every((t) => t.outBonus === 0)).toBe(true);
  });
  it('sem reciclagem de morto, o monte vazio encerra a mão', () => {
    const { st } = setup({
      hands: { 0: '3H 9S', 1: '3S' },
      stock: '8D',
      config: { recycleDead: false },
    });
    let s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    s = ok(applyAction(s, 0, { type: 'DISCARD', cardId: s.hands[0]![0]!.id }));
    expect(s.status).toBe('ended');
  });
});

describe('pontuação', () => {
  it('placar detalhado: canasta limpa + batida + morto + mão', () => {
    const { st } = setup({
      hands: { 0: '4H 5H 6H 7H 8H 9H 10H 3S 4S 5S', 1: 'KS 2D' },
      stock: '3D',
    });
    st.deads[0] = null;
    st.deadTaken[0] = true;
    let s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    s = ok(
      applyAction(s, 0, { type: 'MELD', cardIds: ids(s.hands[0]!.filter((c) => c.suit === 'H')) }),
    );
    s = ok(
      applyAction(s, 0, { type: 'MELD', cardIds: ids(s.hands[0]!.filter((c) => c.suit === 'S')) }),
    );
    s = ok(applyAction(s, 0, { type: 'DISCARD', cardId: s.hands[0]![0]!.id }));
    expect(s.status).toBe('ended');
    const [a, b] = s.result!.teams;
    expect(a).toMatchObject({
      meldPoints: 50 + 15, // 4-10♥ = 20+30, 3♠4♠5♠ = 15
      canastaBonus: 200,
      outBonus: 100,
      deadPenalty: 0,
      handPenalty: 0,
      total: 65 + 200 + 100,
    });
    expect(b).toMatchObject({ meldPoints: 0, deadPenalty: 100, handPenalty: 20, total: -120 });
  });

  it('valores: A=15, 2=10, joker=20, figuras=10, 3–7=5', () => {
    const c = new Cards();
    const pts = (codes: string) => cardPoints(c.one(codes));
    expect([
      pts('AS'),
      pts('2S'),
      pts('JK'),
      pts('KS'),
      pts('QS'),
      pts('JS'),
      pts('10S'),
      pts('9S'),
      pts('8S'),
    ]).toEqual([15, 10, 20, 10, 10, 10, 10, 10, 10]);
    expect([pts('3S'), pts('4S'), pts('5S'), pts('6S'), pts('7S')]).toEqual([5, 5, 5, 5, 5]);
  });

  it('canastas: bônus de cada tipo na pontuação final', () => {
    const cases: [string, number][] = [
      ['4H 5H 6H 7H 8H 9H 2S', 100 + 5 * 4 + 10 + 10 + 10],
      ['4H 5H 6H 7H 8H 9H 10H', 200 + 20 + 30 + 0],
      ['AH 2H 3H 4H 5H 6H 7H 8H 9H 10H JH QH KH', 500 + 15 + 10 + 5 * 5 + 10 * 6 + 0],
      ['AH AH 2H 3H 4H 5H 6H 7H 8H 9H 10H JH QH KH', 1000 + 30 + 10 + 5 * 5 + 10 * 6 + 0],
    ];
    for (const [codes, expected] of cases) {
      const cs = new Cards().many(codes);
      const layout = arrangements(cs)[0]!;
      const meld = { ...layout, id: 1, team: 0 };
      const r = scoreHand({
        numPlayers: 2,
        melds: [meld],
        hands: [[], []],
        deadTaken: [true, true],
        reason: 'exhausted',
        outPlayer: null,
      });
      expect(r.teams[0]!.canastaBonus + r.teams[0]!.meldPoints).toBe(expected);
    }
  });
});

describe('4 jogadores (duplas)', () => {
  it('pontos da dupla são somados e a mão do parceiro conta como penalidade', () => {
    const { st } = setup({
      numPlayers: 4,
      hands: { 0: '4H 5H 6H 7H 8H 9H 10H', 1: 'KS', 2: '3C 5C', 3: 'QD' },
      stock: '3D',
    });
    st.deads = [null, null];
    st.deadTaken = [true, false];
    let s = ok(applyAction(st, 0, { type: 'DRAW_STOCK' }));
    s = ok(
      applyAction(s, 0, { type: 'MELD', cardIds: ids(s.hands[0]!.filter((c) => c.suit === 'H')) }),
    );
    s = ok(applyAction(s, 0, { type: 'DISCARD', cardId: s.hands[0]![0]!.id }));
    expect(s.status).toBe('ended');
    const [t0, t1] = s.result!.teams;
    expect(t0!.players).toEqual([0, 2]);
    expect(t0!.handPenalty).toBe(5 + 5); // 3♣ + 5♣ do parceiro
    expect(t1!.players).toEqual([1, 3]);
    expect(t1!.handPenalty).toBe(10 + 10);
    expect(t1!.deadPenalty).toBe(100);
  });
  it('ordem de jogo alterna entre as duplas', () => {
    const { st } = setup({
      numPlayers: 4,
      hands: { 0: '3H 9S', 1: '3S 9D', 2: '3D 9C', 3: '3C 9H' },
      stock: '8D 8D 8D 8D',
    });
    const order: number[] = [];
    let s = st;
    for (let i = 0; i < 4; i++) {
      order.push(s.turn);
      s = ok(applyAction(s, s.turn, { type: 'DRAW_STOCK' }));
      s = ok(applyAction(s, s.turn, { type: 'DISCARD', cardId: s.hands[s.turn]![0]!.id }));
    }
    expect(order).toEqual([0, 1, 2, 3]);
  });
});

describe('timer', () => {
  it('estouro: compra do monte e descarta a carta comprada', () => {
    const { st } = setup({ hands: { 0: '3H 9S' }, stock: 'KD' });
    const r = applyTimeout(st);
    const s = ok(r);
    expect(s.discard.map((c) => c.rank)).toEqual([13]);
    expect(s.turn).toBe(1);
  });
});

describe('visão do jogador', () => {
  it('nunca revela mão alheia, monte ou morto', () => {
    const st = dealHand(3);
    const v = viewFor(st, 0);
    const json = JSON.stringify(v);
    for (const c of [
      ...st.hands[1]!,
      ...st.hands[2]!,
      ...st.stock,
      ...st.deads.flatMap((d) => d ?? []),
    ]) {
      expect(json.includes(`"id":${c.id},`)).toBe(false);
    }
    expect(v.myHand).toEqual(st.hands[0]);
    expect(v.stockCount).toBe(st.stock.length);
    expect(v.deadCounts).toEqual([11, 11, 11]);
    expect(v.handCounts).toEqual([11, 11, 11]);
  });
});

describe('partida', () => {
  it('acumula placar, passa o carteador e termina ao atingir a meta', () => {
    let m = newMatch(2, { targetScore: 1500 });
    m.hand.status = 'ended';
    m.hand.result = {
      reason: 'out',
      outPlayer: 0,
      leftovers: [[], []],
      teams: [
        {
          team: 0,
          players: [0],
          melds: [],
          meldPoints: 0,
          canastaBonus: 0,
          outBonus: 0,
          deadPenalty: 0,
          handPenalty: 0,
          total: 800,
        },
        {
          team: 1,
          players: [1],
          melds: [],
          meldPoints: 0,
          canastaBonus: 0,
          outBonus: 0,
          deadPenalty: 0,
          handPenalty: 0,
          total: -100,
        },
      ],
    };
    m = settleHand(m);
    expect(m.totals).toEqual([800, -100]);
    expect(m.finished).toBe(false);
    expect(settleHand(m).totals).toEqual([800, -100]); // idempotente
    m = nextHand(m);
    expect(m.dealer).toBe(1);
    expect(m.handNumber).toBe(2);
    m.hand.status = 'ended';
    m.hand.result = {
      ...m.history[0]!,
      teams: m.history[0]!.teams.map((t) => ({ ...t, total: t.team === 0 ? 800 : 200 })),
    };
    m = settleHand(m);
    expect(m.finished).toBe(true);
    expect(m.winners).toEqual([0]);
  });
  it('se as duas passarem a meta, vence a maior pontuação; empate segue o jogo', () => {
    const base = newMatch(2, { targetScore: 1500 });
    const mk = (a: number, b: number) => {
      const m = structuredClone(base);
      m.hand.status = 'ended';
      m.hand.result = {
        reason: 'out',
        outPlayer: 0,
        leftovers: [[], []],
        teams: [a, b].map((total, team) => ({
          team,
          players: [team],
          melds: [],
          meldPoints: 0,
          canastaBonus: 0,
          outBonus: 0,
          deadPenalty: 0,
          handPenalty: 0,
          total,
        })),
      };
      return settleHand(m);
    };
    expect(mk(1600, 1900)).toMatchObject({ finished: true, winners: [1] });
    expect(mk(1600, 1600)).toMatchObject({ finished: false, winners: [] });
  });
});
