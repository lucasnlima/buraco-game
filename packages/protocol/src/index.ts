import { z } from 'zod';
import type { Config, HandResult, PlayerView } from '@buraco/engine';

export const PROTOCOL_VERSION = 1;
export const NAME_MIN = 2;
export const NAME_MAX = 20;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const REACTIONS = ['👏', '😂', '😮', '😡', '🔥', '👍', '🙈', '💀'] as const;
export const SEAT_HOLD_MS = 120_000;
/** Avatares disponíveis no app: 1..AVATAR_COUNT. */
export const AVATAR_COUNT = 25;
export const avatarSchema = z.number().int().min(1).max(AVATAR_COUNT);

export const nameSchema = z
  .string()
  .trim()
  .min(NAME_MIN)
  .max(NAME_MAX)
  .regex(/^[\p{L}\p{N} ._'-]+$/u, "Use letras, números, espaço, . _ - '");
export const tokenSchema = z.string().min(16).max(128);
export const roomCodeSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(
    z
      .string()
      .length(ROOM_CODE_LENGTH)
      .regex(/^[A-Z0-9]+$/),
  );

const ids = z.array(z.number().int().min(0).max(255)).min(1).max(14);
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('DRAW_STOCK') }),
  z.object({ type: z.literal('TAKE_DISCARD') }),
  z.object({ type: z.literal('REJECT_DRAW') }),
  z.object({
    type: z.literal('MELD'),
    cardIds: ids,
    wildPos: z.number().int().min(1).max(14).optional(),
  }),
  z.object({
    type: z.literal('ADD_TO_MELD'),
    meldId: z.number().int(),
    cardIds: ids,
    wildPos: z.number().int().min(1).max(14).optional(),
  }),
  z.object({ type: z.literal('DISCARD'), cardId: z.number().int().min(0).max(255) }),
]);

export const configSchema = z
  .object({
    jokers: z.boolean(),
    acesTrinca: z.boolean(),
    wildReposition: z.boolean(),
    firstDrawRefusal: z.boolean(),
    targetScore: z.union([z.literal(1500), z.literal(3000), z.literal(5000)]),
    dirtyCanastaToGoOut: z.boolean(),
    goOut: z.enum(['both', 'meld', 'discard']),
    recycleDead: z.boolean(),
    turnTimer: z.union([z.literal(0), z.literal(60), z.literal(90)]),
  })
  .partial();

export const helloSchema = z.object({
  t: z.literal('hello'),
  name: nameSchema,
  token: tokenSchema,
  /** ausente = automático (pelo nome). Valor inválido é ignorado, não impede a entrada. */
  avatar: avatarSchema.optional().catch(undefined),
});
export type Hello = z.infer<typeof helloSchema>;

export const clientMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('config'), config: configSchema }),
  z.object({ t: z.literal('seat'), seat: z.number().int().min(0).max(3) }),
  z.object({ t: z.literal('start') }),
  z.object({ t: z.literal('game'), action: actionSchema }),
  z.object({ t: z.literal('nextHand') }),
  z.object({ t: z.literal('rematch') }),
  z.object({ t: z.literal('decision'), wait: z.boolean() }),
  z.object({ t: z.literal('chat'), text: z.string().trim().min(1).max(200) }),
  z.object({ t: z.literal('react'), emoji: z.enum(REACTIONS) }),
  z.object({ t: z.literal('voice'), on: z.boolean() }),
  z.object({ t: z.literal('avatar'), avatar: avatarSchema.nullable() }),
  z.object({
    t: z.literal('rtc'),
    to: z.string().max(64),
    kind: z.enum(['offer', 'answer', 'ice']),
    data: z.unknown(),
  }),
  z.object({ t: z.literal('ping') }),
]);
export type ClientMsg = z.infer<typeof clientMsgSchema>;
export type GameAction = z.infer<typeof actionSchema>;

export type RoomPhase = 'lobby' | 'playing' | 'between' | 'finished' | 'abandoned';

export interface LobbyPlayer {
  id: string;
  name: string;
  seat: number;
  connected: boolean;
  voice: boolean;
  avatar?: number;
}

export interface MatchSummary {
  handNumber: number;
  totals: number[];
  history: HandResult[];
  finished: boolean;
  winners: number[];
}

export type ServerMsg =
  | { t: 'welcome'; you: string; code: string; v: number }
  | {
      t: 'lobby';
      code: string;
      phase: RoomPhase;
      hostId: string;
      config: Config;
      players: LobbyPlayer[];
      /** ids dos jogadores na ordem do engine (índice = assento no jogo) */
      order: string[];
      /** jogador desconectado há mais tempo que o limite: o anfitrião decide */
      pendingDecision: string | null;
    }
  | { t: 'state'; view: PlayerView; match: MatchSummary; deadline: number | null }
  | { t: 'error'; code: string; message: string }
  | { t: 'chat'; from: string; name: string; text: string; ts: number }
  | { t: 'react'; from: string; emoji: string }
  | { t: 'rtc'; from: string; kind: 'offer' | 'answer' | 'ice'; data: unknown }
  | { t: 'pong' };

export interface RankingRow {
  name: string;
  wins: number;
  games: number;
  winRate: number;
  bestScore: number;
}
export interface ProfileData {
  name: string;
  stats: RankingRow;
  recent: {
    finishedAt: number;
    won: boolean;
    score: number;
    numPlayers: number;
    roomCode: string;
  }[];
}
export type RankingPeriod = 'all' | 'week' | 'month';
