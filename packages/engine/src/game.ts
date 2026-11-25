import { type Card, type RandomInt, createDeck, shuffle } from './cards';
import { type Config, normalizeConfig, playersOfTeam, teamCount, teamOf } from './config';
import { ERROR_MESSAGES, type ErrorCode } from './messages';
import { type HandResult, type Meld, scoreHand } from './scoring';
import { type CanastaType, canastaType, resolveAddition, resolveNewMeld } from './sequence';

export const HAND_SIZE = 11;

export type Phase = 'draw' | 'play';

export interface TurnInfo {
  drawnFrom: 'stock' | 'discard' | null;
  /** Carta comprada do monte nesta vez (para recusa / timer). */
  drawnCardId: number | null;
  /** Única carta que havia no lixo: não pode ser descartada na mesma vez. */
  lockedCardId: number | null;
  melded: boolean;
  refused: boolean;
}

export interface HandState {
  version: number;
  config: Config;
  numPlayers: number;
  dealer: number;
  turn: number;
  phase: Phase;
  hands: Card[][];
  /** Topo do monte = último elemento. */
  stock: Card[];
  /** Topo do lixo = último elemento. Visível a todos. */
  discard: Card[];
  /** Morto por time; null = já pego (ou virou monte). */
  deads: (Card[] | null)[];
  deadTaken: boolean[];
  melds: Meld[];
  nextMeldId: number;
  turnInfo: TurnInfo;
  firstTurnPending: boolean;
  status: 'playing' | 'ended';
  result: HandResult | null;
}

export type Action =
  | { type: 'DRAW_STOCK' }
  | { type: 'TAKE_DISCARD' }
  | { type: 'REJECT_DRAW' }
  | { type: 'MELD'; cardIds: number[]; wildPos?: number }
  | { type: 'ADD_TO_MELD'; meldId: number; cardIds: number[]; wildPos?: number }
  | { type: 'DISCARD'; cardId: number };

export type ActionResult =
  { ok: true; state: HandState } | { ok: false; code: ErrorCode; message: string };

const fail = (code: ErrorCode): ActionResult => ({
  ok: false,
  code,
  message: ERROR_MESSAGES[code],
});

export function dealHand(
  numPlayers: number,
  configInput: Partial<Config> = {},
  dealer = 0,
  randInt?: RandomInt,
): HandState {
  if (![2, 3, 4].includes(numPlayers)) throw new Error('numPlayers deve ser 2, 3 ou 4');
  const config = normalizeConfig(configInput);
  const deck = shuffle(createDeck(config.jokers), randInt);
  const hands = Array.from({ length: numPlayers }, () => deck.splice(0, HAND_SIZE));
  const deads = Array.from({ length: teamCount(numPlayers) }, () => deck.splice(0, HAND_SIZE));
  return {
    version: 0,
    config,
    numPlayers,
    dealer,
    turn: (dealer + 1) % numPlayers,
    phase: 'draw',
    hands,
    stock: deck,
    discard: [],
    deads,
    deadTaken: deads.map(() => false),
    melds: [],
    nextMeldId: 1,
    turnInfo: newTurnInfo(),
    firstTurnPending: true,
    status: 'playing',
    result: null,
  };
}

const newTurnInfo = (): TurnInfo => ({
  drawnFrom: null,
  drawnCardId: null,
  lockedCardId: null,
  melded: false,
  refused: false,
});

export function teamMelds(st: HandState, team: number): Meld[] {
  return st.melds.filter((m) => m.team === team);
}

export function hasCanasta(st: HandState, team: number, cleanOnly: boolean): boolean {
  return teamMelds(st, team).some((m) => {
    const t: CanastaType | null = canastaType(m);
    return t !== null && (!cleanOnly || t !== 'suja');
  });
}

/** Requisitos de batida para o time (independente de como zera a mão). */
export function goOutCheck(
  st: HandState,
  team: number,
  how: 'meld' | 'discard',
): { ok: true } | { ok: false; code: ErrorCode } {
  if (st.deads[team] !== null) return { ok: false, code: 'NEED_DEAD' };
  const dirty = st.config.dirtyCanastaToGoOut;
  if (!hasCanasta(st, team, !dirty)) {
    return { ok: false, code: dirty ? 'NEED_CANASTA' : 'NEED_CLEAN_CANASTA' };
  }
  const mode = st.config.goOut;
  if (mode === 'meld' && how === 'discard') return { ok: false, code: 'GO_OUT_MODE_MELD' };
  if (mode === 'discard' && how === 'meld') return { ok: false, code: 'GO_OUT_MODE_DISCARD' };
  return { ok: true };
}

function take(hand: Card[], ids: number[]): Card[] | null {
  if (ids.length === 0 || new Set(ids).size !== ids.length) return null;
  const cards: Card[] = [];
  for (const id of ids) {
    const c = hand.find((x) => x.id === id);
    if (!c) return null;
    cards.push(c);
  }
  return cards;
}

const removeFromHand = (hand: Card[], ids: number[]): Card[] => {
  const set = new Set(ids);
  return hand.filter((c) => !set.has(c.id));
};

function recycleDead(st: HandState): boolean {
  if (!st.config.recycleDead) return false;
  const t = st.deads.findIndex((d) => d !== null);
  if (t < 0) return false;
  st.stock = st.deads[t]!;
  st.deads[t] = null;
  return true;
}

function endHand(st: HandState, reason: 'out' | 'exhausted', outPlayer: number | null): void {
  st.status = 'ended';
  st.result = scoreHand({
    numPlayers: st.numPlayers,
    melds: st.melds,
    hands: st.hands,
    deadTaken: st.deadTaken,
    reason,
    outPlayer,
  });
}

/**
 * Chamado após a mão do jogador mudar durante a fase de jogo (baixar/adicionar).
 * Retorna um erro se a jogada deixaria o jogador sem saída válida.
 */
function afterMeld(st: HandState, player: number): ActionResult | null {
  const team = teamOf(st.numPlayers, player);
  const hand = st.hands[player]!;
  if (hand.length === 0) {
    if (st.deads[team] !== null) {
      // Morto direto: pega agora e segue jogando; encerra a vez com descarte.
      st.hands[player] = st.deads[team]!;
      st.deads[team] = null;
      st.deadTaken[team] = true;
      return null;
    }
    const chk = goOutCheck(st, team, 'meld');
    if (!chk.ok) return fail(chk.code);
    endHand(st, 'out', player);
    return null;
  }
  if (hand.length === 1 && hand[0]!.id === st.turnInfo.lockedCardId) {
    // Só sobrou a carta que não pode ser descartada: ela precisa ter lugar num jogo.
    const fits = teamMelds(st, team).some((m) => resolveAddition(m, hand, st.config));
    const canEmpty = st.deads[team] !== null || goOutCheck(st, team, 'meld').ok;
    return fits && canEmpty ? null : fail('DISCARD_TAKEN_CARD');
  }
  if (hand.length === 1 && st.deads[team] === null) {
    // A última carta teria de ser descartada para bater: precisa ser possível.
    const chk = goOutCheck(st, team, 'discard');
    if (!chk.ok) return fail(chk.code);
  }
  return null;
}

export function applyAction(state: HandState, player: number, action: Action): ActionResult {
  if (state.status !== 'playing') return fail('HAND_OVER');
  if (player !== state.turn) return fail('NOT_YOUR_TURN');
  const st = structuredClone(state);
  st.version++;
  const team = teamOf(st.numPlayers, player);
  const hand = st.hands[player]!;

  switch (action.type) {
    case 'DRAW_STOCK': {
      if (st.phase !== 'draw') return fail('ALREADY_DREW');
      if (st.stock.length === 0 && !recycleDead(st)) {
        endHand(st, 'exhausted', null);
        return { ok: true, state: st };
      }
      const card = st.stock.pop()!;
      hand.push(card);
      st.phase = 'play';
      st.turnInfo = { ...newTurnInfo(), drawnFrom: 'stock', drawnCardId: card.id };
      return { ok: true, state: st };
    }
    case 'TAKE_DISCARD': {
      if (st.phase !== 'draw') return fail('ALREADY_DREW');
      if (st.discard.length === 0) return fail('DISCARD_EMPTY');
      const only = st.discard.length === 1 ? st.discard[0]!.id : null;
      hand.push(...st.discard);
      st.discard = [];
      st.phase = 'play';
      st.turnInfo = { ...newTurnInfo(), drawnFrom: 'discard', lockedCardId: only };
      return { ok: true, state: st };
    }
    case 'REJECT_DRAW': {
      const ti = st.turnInfo;
      if (
        !st.config.firstDrawRefusal ||
        !st.firstTurnPending ||
        st.phase !== 'play' ||
        ti.drawnFrom !== 'stock' ||
        ti.melded ||
        ti.refused
      ) {
        return fail('CANNOT_REFUSE');
      }
      if (st.stock.length === 0) return fail('STOCK_EMPTY');
      const idx = hand.findIndex((c) => c.id === ti.drawnCardId);
      if (idx < 0) return fail('CANNOT_REFUSE');
      st.discard.push(hand.splice(idx, 1)[0]!);
      const next = st.stock.pop()!;
      hand.push(next);
      st.turnInfo = { ...ti, drawnCardId: next.id, refused: true };
      return { ok: true, state: st };
    }
    case 'MELD': {
      if (st.phase !== 'play') return fail('MUST_DRAW');
      const cards = take(hand, action.cardIds);
      if (!cards) return fail('CARDS_NOT_IN_HAND');
      const layout = resolveNewMeld(cards, st.config, action.wildPos);
      if (!layout) return fail('INVALID_MELD');
      st.hands[player] = removeFromHand(hand, action.cardIds);
      st.melds.push({ ...layout, id: st.nextMeldId++, team });
      st.turnInfo.melded = true;
      const err = afterMeld(st, player);
      return err ?? { ok: true, state: st };
    }
    case 'ADD_TO_MELD': {
      if (st.phase !== 'play') return fail('MUST_DRAW');
      const meld = st.melds.find((m) => m.id === action.meldId);
      if (!meld) return fail('MELD_NOT_FOUND');
      if (meld.team !== team) return fail('NOT_YOUR_MELD');
      const cards = take(hand, action.cardIds);
      if (!cards) return fail('CARDS_NOT_IN_HAND');
      const layout = resolveAddition(meld, cards, st.config, action.wildPos);
      if (!layout) return fail('INVALID_ADDITION');
      meld.slots = layout.slots;
      st.hands[player] = removeFromHand(hand, action.cardIds);
      st.turnInfo.melded = true;
      const err = afterMeld(st, player);
      return err ?? { ok: true, state: st };
    }
    case 'DISCARD': {
      if (st.phase !== 'play') return fail('MUST_DRAW');
      const card = hand.find((c) => c.id === action.cardId);
      if (!card) return fail('CARDS_NOT_IN_HAND');
      if (card.id === st.turnInfo.lockedCardId) return fail('DISCARD_TAKEN_CARD');
      st.hands[player] = removeFromHand(hand, [card.id]);
      st.discard.push(card);
      if (st.hands[player]!.length === 0) {
        if (st.deads[team] !== null) {
          // Morto indireto: pega agora, joga com ele na próxima vez.
          st.hands[player] = st.deads[team]!;
          st.deads[team] = null;
          st.deadTaken[team] = true;
        } else {
          const chk = goOutCheck(st, team, 'discard');
          if (!chk.ok) return fail(chk.code);
          endHand(st, 'out', player);
          return { ok: true, state: st };
        }
      }
      st.turn = (st.turn + 1) % st.numPlayers;
      st.phase = 'draw';
      st.turnInfo = newTurnInfo();
      st.firstTurnPending = false;
      if (st.stock.length === 0 && !(st.config.recycleDead && st.deads.some((d) => d !== null))) {
        endHand(st, 'exhausted', null);
      }
      return { ok: true, state: st };
    }
    default:
      return fail('BAD_ACTION');
  }
}

/**
 * Jogada automática para estouro de timer: compra do monte (se ainda não comprou)
 * e descarta a carta comprada.
 */
export function applyTimeout(state: HandState): ActionResult {
  if (state.status !== 'playing') return fail('HAND_OVER');
  let st = state;
  if (st.phase === 'draw') {
    const r = applyAction(st, st.turn, { type: 'DRAW_STOCK' });
    if (!r.ok || r.state.status === 'ended') return r;
    st = r.state;
  }
  const hand = st.hands[st.turn]!;
  const allowed = hand.filter((c) => c.id !== st.turnInfo.lockedCardId);
  const fallback = (allowed[allowed.length - 1] ?? hand[hand.length - 1]!).id;
  const id = st.turnInfo.drawnCardId;
  const cardId = id !== null && allowed.some((c) => c.id === id) ? id : fallback;
  return applyAction(st, st.turn, { type: 'DISCARD', cardId });
}

// ───────────────────────────── Partida (várias mãos) ─────────────────────────────

export interface Match {
  config: Config;
  numPlayers: number;
  handNumber: number;
  dealer: number;
  totals: number[];
  history: HandResult[];
  hand: HandState;
  finished: boolean;
  /** Times vencedores (vazio enquanto a partida não terminou). */
  winners: number[];
}

export function newMatch(
  numPlayers: number,
  configInput: Partial<Config> = {},
  dealer = 0,
  randInt?: RandomInt,
): Match {
  const config = normalizeConfig(configInput);
  return {
    config,
    numPlayers,
    handNumber: 1,
    dealer,
    totals: Array.from({ length: teamCount(numPlayers) }, () => 0),
    history: [],
    hand: dealHand(numPlayers, config, dealer, randInt),
    finished: false,
    winners: [],
  };
}

/** Soma o resultado da mão ao placar e decide se a partida acabou. */
export function settleHand(match: Match): Match {
  const hand = match.hand;
  if (hand.status !== 'ended' || !hand.result) throw new Error('A mão ainda não terminou');
  if (match.history.length >= match.handNumber) return match; // já contabilizada
  const m = structuredClone(match);
  m.history.push(hand.result);
  hand.result.teams.forEach((t) => {
    m.totals[t.team]! += t.total;
  });
  const max = Math.max(...m.totals);
  if (max >= m.config.targetScore) {
    m.finished = true;
    m.winners = m.totals.flatMap((t, i) => (t === max ? [i] : []));
    // Empate no topo: segue para outra mão.
    if (m.winners.length > 1) {
      m.finished = false;
      m.winners = [];
    }
  }
  return m;
}

export function nextHand(match: Match, randInt?: RandomInt): Match {
  if (match.finished) throw new Error('A partida já terminou');
  const m = structuredClone(match);
  m.handNumber++;
  m.dealer = (m.dealer + 1) % m.numPlayers;
  m.hand = dealHand(m.numPlayers, m.config, m.dealer, randInt);
  return m;
}

/** Jogadores vencedores da partida (duplas contam para os dois). */
export function winningPlayers(match: Match): number[] {
  return match.winners.flatMap((t) => playersOfTeam(match.numPlayers, t));
}
