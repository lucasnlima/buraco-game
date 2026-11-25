import type { ProfileData, RankingPeriod, RankingRow } from '@buraco/protocol';

export interface MatchRecord {
  id: string;
  roomCode: string;
  numPlayers: number;
  targetScore: number;
  handsPlayed: number;
  finishedAt: number;
  players: { playerId: string; team: number; score: number; won: boolean }[];
}

export interface Store {
  /** Cria o jogador se o nome é novo; devolve null se o nome pertence a outro token. */
  authenticate(name: string, token: string): Promise<{ id: string; name: string } | null>;
  recordMatch(rec: MatchRecord): Promise<void>;
  ranking(period: RankingPeriod, limit?: number): Promise<RankingRow[]>;
  profile(name: string): Promise<ProfileData | null>;
}

export async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const DAY = 86_400_000;
export const periodStart = (p: RankingPeriod, now = Date.now()): number =>
  p === 'week' ? now - 7 * DAY : p === 'month' ? now - 30 * DAY : 0;

export const toRow = (name: string, wins: number, games: number, best: number): RankingRow => ({
  name,
  wins,
  games,
  winRate: games ? Math.round((wins / games) * 1000) / 10 : 0,
  bestScore: best,
});

/** Implementação em memória (testes e servidor de desenvolvimento). */
export class MemoryStore implements Store {
  private players = new Map<string, { id: string; name: string; hash: string }>();
  private matches: MatchRecord[] = [];

  async authenticate(name: string, token: string) {
    const key = name.toLowerCase();
    const hash = await hashToken(token);
    const p = this.players.get(key);
    if (!p) {
      const created = { id: crypto.randomUUID(), name, hash };
      this.players.set(key, created);
      return { id: created.id, name };
    }
    return p.hash === hash ? { id: p.id, name: p.name } : null;
  }
  async recordMatch(rec: MatchRecord) {
    this.matches.push(rec);
  }
  private rows(since: number): Map<string, { wins: number; games: number; best: number }> {
    const agg = new Map<string, { wins: number; games: number; best: number }>();
    for (const m of this.matches) {
      if (m.finishedAt < since) continue;
      for (const p of m.players) {
        const a = agg.get(p.playerId) ?? { wins: 0, games: 0, best: -Infinity };
        a.games++;
        if (p.won) a.wins++;
        a.best = Math.max(a.best, p.score);
        agg.set(p.playerId, a);
      }
    }
    return agg;
  }
  async ranking(period: RankingPeriod, limit = 50) {
    const nameOf = new Map([...this.players.values()].map((p) => [p.id, p.name]));
    return [...this.rows(periodStart(period)).entries()]
      .map(([id, a]) => toRow(nameOf.get(id) ?? '?', a.wins, a.games, a.best))
      .sort((a, b) => b.wins - a.wins || a.games - b.games || b.bestScore - a.bestScore)
      .slice(0, limit);
  }
  async profile(name: string) {
    const p = this.players.get(name.toLowerCase());
    if (!p) return null;
    const a = this.rows(0).get(p.id) ?? { wins: 0, games: 0, best: 0 };
    const recent = this.matches
      .filter((m) => m.players.some((x) => x.playerId === p.id))
      .sort((x, y) => y.finishedAt - x.finishedAt)
      .slice(0, 20)
      .map((m) => {
        const me = m.players.find((x) => x.playerId === p.id)!;
        return {
          finishedAt: m.finishedAt,
          won: me.won,
          score: me.score,
          numPlayers: m.numPlayers,
          roomCode: m.roomCode,
        };
      });
    return { name: p.name, stats: toRow(p.name, a.wins, a.games, a.games ? a.best : 0), recent };
  }
}
