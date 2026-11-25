import type { RankingPeriod } from '@buraco/protocol';
import { type MatchRecord, type Store, hashToken, periodStart, toRow } from './store-core';

export * from './store-core';

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
