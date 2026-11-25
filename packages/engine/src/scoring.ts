import { type Card, cardPoints } from './cards';
import { playersOfTeam, teamCount } from './config';
import { type CanastaType, type Layout, canastaType } from './sequence';

export const CANASTA_BONUS: Record<CanastaType, number> = {
  suja: 100,
  limpa: 200,
  meia_real: 500,
  real: 1000,
};
export const OUT_BONUS = 100;
export const NO_DEAD_PENALTY = 100;

export interface Meld extends Layout {
  id: number;
  team: number;
}

export interface MeldScore {
  meldId: number;
  canasta: CanastaType | null;
  cardPoints: number;
  bonus: number;
}

export interface TeamScore {
  team: number;
  players: number[];
  melds: MeldScore[];
  meldPoints: number;
  canastaBonus: number;
  outBonus: number;
  deadPenalty: number;
  handPenalty: number;
  total: number;
}

export interface HandResult {
  reason: 'out' | 'exhausted';
  /** Jogador que bateu (null se a mão acabou por monte esgotado). */
  outPlayer: number | null;
  teams: TeamScore[];
  /** Cartas que sobraram na mão de cada jogador (revelado no fim da mão). */
  leftovers: Card[][];
}

export const sumPoints = (cards: Card[]): number => cards.reduce((t, c) => t + cardPoints(c), 0);

export function scoreHand(args: {
  numPlayers: number;
  melds: Meld[];
  hands: Card[][];
  deadTaken: boolean[];
  reason: 'out' | 'exhausted';
  outPlayer: number | null;
}): HandResult {
  const { numPlayers, melds, hands, deadTaken, reason, outPlayer } = args;
  const teams: TeamScore[] = [];
  for (let team = 0; team < teamCount(numPlayers); team++) {
    const players = playersOfTeam(numPlayers, team);
    const meldScores: MeldScore[] = melds
      .filter((m) => m.team === team)
      .map((m) => {
        const canasta = canastaType(m);
        return {
          meldId: m.id,
          canasta,
          cardPoints: sumPoints(m.slots.map((s) => s.card)),
          bonus: canasta ? CANASTA_BONUS[canasta] : 0,
        };
      });
    const meldPoints = meldScores.reduce((t, m) => t + m.cardPoints, 0);
    const canastaBonus = meldScores.reduce((t, m) => t + m.bonus, 0);
    const outBonus =
      reason === 'out' && outPlayer !== null && players.includes(outPlayer) ? OUT_BONUS : 0;
    const deadPenalty = deadTaken[team] ? 0 : NO_DEAD_PENALTY;
    const handPenalty = players.reduce((t, p) => t + sumPoints(hands[p] ?? []), 0);
    teams.push({
      team,
      players,
      melds: meldScores,
      meldPoints,
      canastaBonus,
      outBonus,
      deadPenalty,
      handPenalty,
      total: meldPoints + canastaBonus + outBonus - deadPenalty - handPenalty,
    });
  }
  return { reason, outPlayer, teams, leftovers: hands.map((h) => h.slice()) };
}
