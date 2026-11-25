import type { Card } from './cards';
import type { Config } from './config';
import { teamOf } from './config';
import type { HandState, Phase } from './game';
import type { HandResult, Meld } from './scoring';

/** O que um jogador específico pode ver — nunca mãos alheias nem a ordem do monte/morto. */
export interface PlayerView {
  version: number;
  config: Config;
  numPlayers: number;
  dealer: number;
  turn: number;
  phase: Phase;
  status: 'playing' | 'ended';
  you: number;
  yourTeam: number;
  myHand: Card[];
  handCounts: number[];
  stockCount: number;
  discard: Card[];
  /** Por time: quantas cartas há no morto (0 se já pego/virou monte). */
  deadCounts: number[];
  deadTaken: boolean[];
  melds: Meld[];
  drawnFrom: 'stock' | 'discard' | null;
  canRefuseDraw: boolean;
  /** Resultado (inclui as sobras de todos) só quando a mão termina. */
  result: HandResult | null;
}

export function viewFor(st: HandState, player: number): PlayerView {
  const ti = st.turnInfo;
  return {
    version: st.version,
    config: st.config,
    numPlayers: st.numPlayers,
    dealer: st.dealer,
    turn: st.turn,
    phase: st.phase,
    status: st.status,
    you: player,
    yourTeam: teamOf(st.numPlayers, player),
    myHand: st.hands[player]!.slice(),
    handCounts: st.hands.map((h) => h.length),
    stockCount: st.stock.length,
    discard: st.discard.slice(),
    deadCounts: st.deads.map((d) => d?.length ?? 0),
    deadTaken: st.deadTaken.slice(),
    melds: structuredClone(st.melds),
    drawnFrom: ti.drawnFrom,
    canRefuseDraw:
      st.status === 'playing' &&
      player === st.turn &&
      st.config.firstDrawRefusal &&
      st.firstTurnPending &&
      st.phase === 'play' &&
      ti.drawnFrom === 'stock' &&
      !ti.melded &&
      !ti.refused,
    result: st.result,
  };
}
