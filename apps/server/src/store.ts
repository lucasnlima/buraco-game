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

const toRow = (name: string, wins: number, games: number, best: number): RankingRow => ({
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

/** Implementação Cloudflare D1. Esquema em `migrations/0001_init.sql`. */
export class D1Store implements Store {
  constructor(private db: D1Database) {}

  async authenticate(name: string, token: string) {
    const hash = await hashToken(token);
    const row = await this.db
      .prepare('SELECT id, name, token_hash FROM players WHERE name = ?1 COLLATE NOCASE')
      .bind(name)
      .first<{ id: string; name: string; token_hash: string }>();
    if (!row) {
      const id = crypto.randomUUID();
      try {
        await this.db
          .prepare('INSERT INTO players (id, name, token_hash, created_at) VALUES (?1, ?2, ?3, ?4)')
          .bind(id, name, hash, Date.now())
          .run();
        return { id, name };
      } catch {
        return null; // corrida: outro dispositivo registrou o nome agora
      }
    }
    return row.token_hash === hash ? { id: row.id, name: row.name } : null;
  }

  async recordMatch(rec: MatchRecord) {
    const stmts = [
      this.db
        .prepare(
          'INSERT OR IGNORE INTO matches (id, room_code, num_players, target_score, hands_played, finished_at) VALUES (?1,?2,?3,?4,?5,?6)',
        )
        .bind(
          rec.id,
          rec.roomCode,
          rec.numPlayers,
          rec.targetScore,
          rec.handsPlayed,
          rec.finishedAt,
        ),
      ...rec.players.map((p) =>
        this.db
          .prepare(
            'INSERT OR IGNORE INTO match_players (match_id, player_id, team, score, won) VALUES (?1,?2,?3,?4,?5)',
          )
          .bind(rec.id, p.playerId, p.team, p.score, p.won ? 1 : 0),
      ),
    ];
    await this.db.batch(stmts);
  }

  async ranking(period: RankingPeriod, limit = 50) {
    const { results } = await this.db
      .prepare(
        `SELECT p.name AS name, SUM(mp.won) AS wins, COUNT(*) AS games, MAX(mp.score) AS best
         FROM match_players mp
         JOIN matches m ON m.id = mp.match_id
         JOIN players p ON p.id = mp.player_id
         WHERE m.finished_at >= ?1
         GROUP BY p.id
         ORDER BY wins DESC, games ASC, best DESC
         LIMIT ?2`,
      )
      .bind(periodStart(period), limit)
      .all<{ name: string; wins: number; games: number; best: number }>();
    return results.map((r) => toRow(r.name, r.wins, r.games, r.best));
  }

  async profile(name: string) {
    const p = await this.db
      .prepare('SELECT id, name FROM players WHERE name = ?1 COLLATE NOCASE')
      .bind(name)
      .first<{ id: string; name: string }>();
    if (!p) return null;
    const agg = await this.db
      .prepare(
        'SELECT SUM(won) AS wins, COUNT(*) AS games, MAX(score) AS best FROM match_players WHERE player_id = ?1',
      )
      .bind(p.id)
      .first<{ wins: number | null; games: number; best: number | null }>();
    const { results } = await this.db
      .prepare(
        `SELECT m.finished_at AS finishedAt, mp.won AS won, mp.score AS score, m.num_players AS numPlayers, m.room_code AS roomCode
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.player_id = ?1 ORDER BY m.finished_at DESC LIMIT 20`,
      )
      .bind(p.id)
      .all<{
        finishedAt: number;
        won: number;
        score: number;
        numPlayers: number;
        roomCode: string;
      }>();
    return {
      name: p.name,
      stats: toRow(p.name, agg?.wins ?? 0, agg?.games ?? 0, agg?.best ?? 0),
      recent: results.map((r) => ({ ...r, won: !!r.won })),
    };
  }
}
