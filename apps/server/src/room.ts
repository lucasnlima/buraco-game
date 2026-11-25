import {
  type Action,
  type Config,
  type Match,
  type RandomInt,
  applyAction,
  applyTimeout,
  newMatch,
  nextHand,
  normalizeConfig,
  settleHand,
  viewFor,
  winningPlayers,
} from '@buraco/engine';
import {
  type ClientMsg,
  type LobbyPlayer,
  type MatchSummary,
  PROTOCOL_VERSION,
  type RoomPhase,
  SEAT_HOLD_MS,
  type ServerMsg,
} from '@buraco/protocol';
import type { Store } from './store-core';

export interface PlayerRec {
  id: string;
  name: string;
  seat: number;
  /** null = conectado */
  disconnectedAt: number | null;
  voice: boolean;
  /** avatar escolhido; ausente = automático */
  avatar?: number;
  /** o anfitrião escolheu esperar este jogador */
  waiting: boolean;
}

export interface RoomSnapshot {
  code: string;
  hostId: string;
  config: Config;
  players: PlayerRec[];
  phase: RoomPhase;
  match: Match | null;
  order: string[];
  deadline: number | null;
  recorded: boolean;
  pendingDecision: string | null;
}

export interface RoomDeps {
  now: () => number;
  send: (playerId: string, msg: ServerMsg) => void;
  store: Store;
  randInt?: RandomInt;
}

type Bucket = { tokens: number; at: number };
const RATE_CAPACITY = 80;
const RATE_PER_SEC = 20;

export class Room {
  s: RoomSnapshot;
  private buckets = new Map<string, Bucket>();

  constructor(
    private deps: RoomDeps,
    init: RoomSnapshot | { code: string },
  ) {
    this.s =
      'players' in init
        ? init
        : {
            code: init.code,
            hostId: '',
            config: normalizeConfig(),
            players: [],
            phase: 'lobby',
            match: null,
            order: [],
            deadline: null,
            recorded: false,
            pendingDecision: null,
          };
  }

  snapshot(): RoomSnapshot {
    return this.s;
  }
  get isEmpty(): boolean {
    return this.s.players.length === 0;
  }

  private player(id: string): PlayerRec | undefined {
    return this.s.players.find((p) => p.id === id);
  }
  private err(id: string, code: string, message: string): void {
    this.deps.send(id, { t: 'error', code, message });
  }

  // ───────── entrada/saída ─────────
  join(
    id: string,
    name: string,
    avatar?: number,
  ): { ok: true } | { ok: false; code: string; message: string } {
    const existing = this.player(id);
    if (existing) {
      existing.disconnectedAt = null;
      existing.waiting = false;
      existing.name = name;
      existing.avatar = avatar;
      if (this.s.pendingDecision === id) this.s.pendingDecision = null;
    } else {
      if (this.s.phase !== 'lobby') {
        return { ok: false, code: 'IN_PROGRESS', message: 'A partida desta sala já começou.' };
      }
      if (this.s.players.length >= 4)
        return { ok: false, code: 'ROOM_FULL', message: 'Sala cheia (máximo 4).' };
      const taken = new Set(this.s.players.map((p) => p.seat));
      const seat = [0, 1, 2, 3].find((x) => !taken.has(x))!;
      this.s.players.push({
        id,
        name,
        avatar,
        seat,
        disconnectedAt: null,
        voice: false,
        waiting: false,
      });
      if (!this.s.hostId) this.s.hostId = id;
    }
    this.deps.send(id, { t: 'welcome', you: id, code: this.s.code, v: PROTOCOL_VERSION });
    this.broadcastLobby();
    if (this.s.match) this.sendState(id);
    return { ok: true };
  }

  disconnect(id: string): void {
    const p = this.player(id);
    if (!p || p.disconnectedAt !== null) return;
    p.disconnectedAt = this.deps.now();
    p.voice = false;
    this.broadcastLobby();
  }

  private removePlayer(id: string): void {
    this.s.players = this.s.players.filter((p) => p.id !== id);
    if (this.s.hostId === id) {
      const next = this.s.players.find((p) => p.disconnectedAt === null) ?? this.s.players[0];
      this.s.hostId = next?.id ?? '';
    }
  }

  // ───────── mensagens ─────────
  private allow(id: string): boolean {
    const now = this.deps.now();
    const b = this.buckets.get(id) ?? { tokens: RATE_CAPACITY, at: now };
    b.tokens = Math.min(RATE_CAPACITY, b.tokens + ((now - b.at) / 1000) * RATE_PER_SEC);
    b.at = now;
    this.buckets.set(id, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  handle(id: string, msg: ClientMsg): void {
    const me = this.player(id);
    if (!me) return;
    if (!this.allow(id)) return this.err(id, 'RATE_LIMIT', 'Devagar! Muitas mensagens.');
    const isHost = this.s.hostId === id;

    switch (msg.t) {
      case 'ping':
        return this.deps.send(id, { t: 'pong' });
      case 'config':
        if (!isHost || this.s.phase !== 'lobby')
          return this.err(id, 'FORBIDDEN', 'Só o anfitrião muda as regras, no lobby.');
        this.s.config = normalizeConfig({ ...this.s.config, ...msg.config });
        return this.broadcastLobby();
      case 'seat': {
        if (this.s.phase !== 'lobby') return;
        if (this.s.players.some((p) => p.seat === msg.seat && p.id !== id)) {
          return this.err(id, 'SEAT_TAKEN', 'Esse lugar já está ocupado.');
        }
        me.seat = msg.seat;
        return this.broadcastLobby();
      }
      case 'start': {
        if (!isHost || this.s.phase !== 'lobby')
          return this.err(id, 'FORBIDDEN', 'Só o anfitrião inicia a partida.');
        const seated = [...this.s.players].sort((a, b) => a.seat - b.seat);
        if (seated.length < 2)
          return this.err(id, 'NOT_ENOUGH', 'São necessários pelo menos 2 jogadores.');
        if (seated.some((p) => p.disconnectedAt !== null))
          return this.err(id, 'OFFLINE', 'Há jogador desconectado.');
        this.s.order = seated.map((p) => p.id);
        const n = seated.length;
        this.s.match = newMatch(
          n,
          this.s.config,
          (this.deps.randInt ?? ((m) => Math.floor(Math.random() * m)))(n),
          this.deps.randInt,
        );
        this.s.phase = 'playing';
        this.s.recorded = false;
        this.resetDeadline(true);
        this.broadcastLobby();
        return this.broadcastState();
      }
      case 'game':
        return this.onGame(id, msg.action as Action);
      case 'nextHand':
        if (this.s.phase !== 'between' || !this.s.match) return;
        this.s.match = nextHand(this.s.match, this.deps.randInt);
        this.s.phase = 'playing';
        this.resetDeadline(true);
        this.broadcastLobby();
        return this.broadcastState();
      case 'rematch':
        if (!isHost || (this.s.phase !== 'finished' && this.s.phase !== 'abandoned')) return;
        this.s.phase = 'lobby';
        this.s.match = null;
        this.s.order = [];
        this.s.deadline = null;
        this.s.players = this.s.players.filter((p) => p.disconnectedAt === null);
        return this.broadcastLobby();
      case 'decision':
        if (!isHost || !this.s.pendingDecision) return;
        if (msg.wait) {
          const p = this.player(this.s.pendingDecision);
          if (p) p.waiting = true;
          this.s.pendingDecision = null;
        } else {
          this.s.phase = 'abandoned';
          this.s.deadline = null;
          this.s.pendingDecision = null;
        }
        return this.broadcastLobby();
      case 'chat':
        return this.broadcast({
          t: 'chat',
          from: id,
          name: me.name,
          text: msg.text,
          ts: this.deps.now(),
        });
      case 'react':
        return this.broadcast({ t: 'react', from: id, emoji: msg.emoji });
      case 'voice':
        me.voice = msg.on;
        return this.broadcastLobby();
      case 'avatar':
        me.avatar = msg.avatar ?? undefined;
        return this.broadcastLobby();
      case 'rtc': {
        const to = this.player(msg.to);
        if (to && to.disconnectedAt === null)
          this.deps.send(to.id, { t: 'rtc', from: id, kind: msg.kind, data: msg.data });
        return;
      }
    }
  }

  private onGame(id: string, action: Action): void {
    const match = this.s.match;
    if (this.s.phase !== 'playing' || !match)
      return this.err(id, 'NOT_PLAYING', 'Não há mão em andamento.');
    const idx = this.s.order.indexOf(id);
    if (idx < 0) return this.err(id, 'NOT_SEATED', 'Você não está nesta partida.');
    const r = applyAction(match.hand, idx, action);
    if (!r.ok) return this.err(id, r.code, r.message);
    this.commit(r.state);
  }

  private commit(hand: Match['hand']): void {
    const prevTurn = this.s.match!.hand.turn;
    this.s.match!.hand = hand;
    if (hand.status === 'ended') {
      this.s.match = settleHand(this.s.match!);
      this.s.deadline = null;
      if (this.s.match.finished) {
        this.s.phase = 'finished';
        this.record();
      } else this.s.phase = 'between';
      this.broadcastLobby();
    } else {
      this.resetDeadline(prevTurn !== hand.turn);
    }
    this.broadcastState();
  }

  private record(): void {
    const m = this.s.match!;
    if (this.s.recorded) return;
    this.s.recorded = true;
    const winners = new Set(winningPlayers(m));
    const teamOf = (i: number) => (m.numPlayers === 4 ? i % 2 : i);
    void this.deps.store
      .recordMatch({
        id: crypto.randomUUID(),
        roomCode: this.s.code,
        numPlayers: m.numPlayers,
        targetScore: m.config.targetScore,
        handsPlayed: m.history.length,
        finishedAt: this.deps.now(),
        players: this.s.order.map((pid, i) => ({
          playerId: pid,
          team: teamOf(i),
          score: m.totals[teamOf(i)]!,
          won: winners.has(i),
        })),
      })
      .catch(() => {
        this.s.recorded = false; // tentará de novo no próximo tick
      });
  }

  private resetDeadline(force: boolean): void {
    const secs = this.s.config.turnTimer;
    const hand = this.s.match?.hand;
    if (!secs || !hand || hand.status !== 'playing' || this.s.phase !== 'playing') {
      this.s.deadline = null;
    } else if (force || this.s.deadline === null) {
      this.s.deadline = this.deps.now() + secs * 1000;
    }
  }

  // ───────── relógio ─────────
  /** Chamar periodicamente / no alarme. Devolve quando precisa ser chamado de novo (ms epoch) ou null. */
  tick(): number | null {
    const now = this.deps.now();
    let changed = false;
    if (
      this.s.phase === 'playing' &&
      this.s.deadline !== null &&
      now >= this.s.deadline &&
      this.s.match
    ) {
      const r = applyTimeout(this.s.match.hand);
      if (r.ok) {
        this.s.deadline = null;
        this.commit(r.state);
        this.s.deadline = this.s.phase === 'playing' ? now + this.s.config.turnTimer * 1000 : null;
      }
    }
    if (this.s.phase === 'lobby') {
      for (const p of [...this.s.players]) {
        if (p.disconnectedAt !== null && now - p.disconnectedAt >= SEAT_HOLD_MS) {
          this.removePlayer(p.id);
          changed = true;
        }
      }
    } else if (this.s.phase !== 'abandoned' && !this.s.pendingDecision) {
      const gone = this.s.players.find(
        (p) => !p.waiting && p.disconnectedAt !== null && now - p.disconnectedAt >= SEAT_HOLD_MS,
      );
      if (gone) {
        this.s.pendingDecision = gone.id;
        changed = true;
      }
    }
    if (this.s.match?.finished && !this.s.recorded) this.record();
    if (changed) this.broadcastLobby();

    const times: number[] = [];
    if (this.s.phase === 'playing' && this.s.deadline !== null) times.push(this.s.deadline);
    for (const p of this.s.players)
      if (p.disconnectedAt !== null && !p.waiting) times.push(p.disconnectedAt + SEAT_HOLD_MS);
    const future = times.filter((t) => t > now);
    return future.length
      ? Math.min(...future)
      : this.s.deadline !== null && this.s.deadline <= now
        ? now + 1000
        : null;
  }

  // ───────── difusão ─────────
  private broadcast(msg: ServerMsg): void {
    for (const p of this.s.players) if (p.disconnectedAt === null) this.deps.send(p.id, msg);
  }

  broadcastLobby(): void {
    const players: LobbyPlayer[] = this.s.players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      connected: p.disconnectedAt === null,
      voice: p.voice,
      avatar: p.avatar,
    }));
    this.broadcast({
      t: 'lobby',
      code: this.s.code,
      phase: this.s.phase,
      hostId: this.s.hostId,
      config: this.s.config,
      players,
      order: this.s.order,
      pendingDecision: this.s.pendingDecision,
    });
  }

  broadcastState(): void {
    for (const p of this.s.players) if (p.disconnectedAt === null) this.sendState(p.id);
  }

  sendState(id: string): void {
    const m = this.s.match;
    const idx = this.s.order.indexOf(id);
    if (!m || idx < 0) return;
    const summary: MatchSummary = {
      handNumber: m.handNumber,
      totals: m.totals,
      history: m.history,
      finished: m.finished,
      winners: m.winners,
    };
    this.deps.send(id, {
      t: 'state',
      view: viewFor(m.hand, idx),
      match: summary,
      deadline: this.s.deadline,
    });
  }
}
