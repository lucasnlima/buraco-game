import type { PlayerView } from '@buraco/engine';
import { type ClientMsg, type MatchSummary, type ServerMsg, avatarSchema } from '@buraco/protocol';
import { create } from 'zustand';
import { t } from './i18n';
import { startLocalGame } from './local';
import { type Identity, api, loadIdentity, newToken, saveIdentity, wsUrl } from './net';

type Lobby = Extract<ServerMsg, { t: 'lobby' }>;
export interface ChatLine {
  from: string;
  name: string;
  text: string;
  ts: number;
}
export interface Reaction {
  key: number;
  from: string;
  emoji: string;
}
export type Page = 'home' | 'ranking' | 'profile' | 'howto';

interface Settings {
  fourColors: boolean;
  haptics: boolean;
  sort: 'suit' | 'rank';
  /** null = automático (pelo nome) */
  avatar: number | null;
}
const SETTINGS_KEY = 'buraco.settings';
const DEFAULTS: Settings = { fourColors: false, haptics: true, sort: 'suit', avatar: null };
const loadSettings = (): Settings => {
  try {
    const s: Settings = {
      ...DEFAULTS,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'),
    };
    return { ...s, avatar: avatarSchema.safeParse(s.avatar).data ?? null };
  } catch {
    return DEFAULTS;
  }
};

interface State {
  identity: Identity | null;
  page: Page;
  profileName: string | null;
  myId: string | null;
  code: string | null;
  connected: boolean;
  lobby: Lobby | null;
  game: { view: PlayerView; match: MatchSummary; deadline: number | null } | null;
  chat: ChatLine[];
  unread: number;
  reactions: Reaction[];
  toast: string | null;
  settings: Settings;
  setPage: (p: Page, profileName?: string | null) => void;
  setName: (name: string) => Promise<string | null>;
  createRoom: () => Promise<string | null>;
  joinRoom: (code: string) => Promise<string | null>;
  leaveRoom: () => void;
  startLocal: (name: string, bots: number) => string | null;
  send: (m: ClientMsg) => void;
  say: (msg: string) => void;
  updateSettings: (s: Partial<Settings>) => void;
  clearUnread: () => void;
  // hooks de voz (registrados por voice.ts)
  onRtc: ((from: string, kind: 'offer' | 'answer' | 'ice', data: unknown) => void) | null;
}

let ws: WebSocket | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let reactionKey = 0;
let intentionalClose = false;
let local: ReturnType<typeof startLocalGame> | null = null;

const LAST_ROOM = 'buraco.lastRoom';

export const useStore = create<State>()((set, get) => {
  function connect(code: string) {
    const id = get().identity;
    if (!id) return;
    intentionalClose = false;
    clearTimeout(retryTimer);
    ws?.close();
    const sock = new WebSocket(wsUrl(code));
    ws = sock;
    sock.onopen = () => {
      retry = 0;
      const avatar = get().settings.avatar ?? undefined;
      sock.send(JSON.stringify({ t: 'hello', name: id.name, token: id.token, avatar }));
      clearInterval(pingTimer);
      pingTimer = setInterval(
        () => sock.readyState === 1 && sock.send(JSON.stringify({ t: 'ping' })),
        25000,
      );
    };
    sock.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(ev.data as string) as ServerMsg;
      } catch {
        return;
      }
      handle(m);
    };
    sock.onclose = (ev) => {
      if (ws !== sock) return;
      set({ connected: false });
      clearInterval(pingTimer);
      if (intentionalClose || [4000, 4001, 4002, 4003].includes(ev.code)) return;
      const delay = Math.min(8000, 500 * 2 ** retry++);
      retryTimer = setTimeout(() => get().code && connect(get().code!), delay);
    };
  }

  function handle(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        set({ myId: m.you, connected: true, code: m.code });
        if (m.code === 'LOCAL') break;
        try {
          localStorage.setItem(LAST_ROOM, m.code);
        } catch {
          /* ignore */
        }
        break;
      case 'lobby':
        set({ lobby: m });
        break;
      case 'state':
        set({ game: { view: m.view, match: m.match, deadline: m.deadline } });
        break;
      case 'error':
        if (['ROOM_FULL', 'IN_PROGRESS', 'NAME_TAKEN'].includes(m.code)) {
          intentionalClose = true;
          set({ code: null, lobby: null, game: null });
        }
        get().say(m.message);
        break;
      case 'chat':
        set((s) => ({ chat: [...s.chat.slice(-99), m], unread: s.unread + 1 }));
        break;
      case 'react': {
        const r = { key: ++reactionKey, from: m.from, emoji: m.emoji };
        set((s) => ({ reactions: [...s.reactions, r] }));
        setTimeout(
          () => set((s) => ({ reactions: s.reactions.filter((x) => x.key !== r.key) })),
          2300,
        );
        break;
      }
      case 'rtc':
        get().onRtc?.(m.from, m.kind, m.data);
        break;
    }
  }

  return {
    identity: loadIdentity(),
    page: 'home',
    profileName: null,
    myId: null,
    code: null,
    connected: false,
    lobby: null,
    game: null,
    chat: [],
    unread: 0,
    reactions: [],
    toast: null,
    settings: loadSettings(),
    onRtc: null,

    setPage: (page, profileName = null) => set({ page, profileName }),

    async setName(name) {
      const prev = get().identity;
      const identity: Identity = { name: name.trim(), token: prev?.token ?? newToken() };
      const r = await api.login(identity).catch(() => null);
      if (!r) return 'Sem conexão com o servidor.';
      if (r.status === 409) {
        // outro dispositivo usa esse nome com outro token
        return t.nameTaken;
      }
      if (!r.ok) return (r.data as { message?: string }).message ?? 'Nome inválido.';
      saveIdentity(identity);
      set({ identity });
      return null;
    },

    async createRoom() {
      const id = get().identity;
      if (!id) return 'Informe seu nome.';
      const r = await api.createRoom(id).catch(() => null);
      if (!r || !r.ok)
        return (
          (r?.data as { message?: string } | undefined)?.message ?? 'Sem conexão com o servidor.'
        );
      set({ code: r.data.code, chat: [], game: null, lobby: null });
      connect(r.data.code);
      return null;
    },

    async joinRoom(raw) {
      const code = raw.trim().toUpperCase();
      if (!/^[A-Z0-9]{5}$/.test(code)) return t.roomNotFound;
      if (!(await api.roomExists(code).catch(() => false))) return t.roomNotFound;
      set({ code, chat: [], game: null, lobby: null });
      connect(code);
      return null;
    },

    startLocal(name, bots) {
      const clean = name.trim();
      if (clean.length < 2 || clean.length > 20) return 'Use de 2 a 20 caracteres.';
      const identity: Identity = { name: clean, token: get().identity?.token ?? newToken() };
      saveIdentity(identity);
      local?.stop();
      set({
        identity,
        code: 'LOCAL',
        myId: 'you',
        connected: true,
        chat: [],
        game: null,
        lobby: null,
      });
      const avatar = get().settings.avatar ?? undefined;
      local = startLocalGame({ name: clean, avatar, bots, deliver: handle });
      return null;
    },

    leaveRoom() {
      local?.stop();
      local = null;
      intentionalClose = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      ws?.close();
      ws = null;
      try {
        localStorage.removeItem(LAST_ROOM);
      } catch {
        /* ignore */
      }
      set({
        code: null,
        lobby: null,
        game: null,
        connected: false,
        myId: null,
        chat: [],
        page: 'home',
      });
      history.replaceState(null, '', location.pathname);
    },

    send(m) {
      if (local) return local.send(m);
      if (ws?.readyState === 1) ws.send(JSON.stringify(m));
    },

    say(msg) {
      clearTimeout(toastTimer);
      set({ toast: msg });
      toastTimer = setTimeout(() => set({ toast: null }), 3800);
    },

    updateSettings(s) {
      const settings = { ...get().settings, ...s };
      set({ settings });
      // dentro de uma sala, avisa os outros na hora
      if (s.avatar !== undefined && get().lobby) get().send({ t: 'avatar', avatar: s.avatar });
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        /* ignore */
      }
    },
    clearUnread: () => set({ unread: 0 }),
  };
});

/** Reentra na última sala após recarregar a página / reabrir o app. */
export function resumeLastRoom(): void {
  try {
    const code = localStorage.getItem(LAST_ROOM);
    if (code && useStore.getState().identity) void useStore.getState().joinRoom(code);
  } catch {
    /* ignore */
  }
}

export const buzz = (ms = 20): void => {
  if (useStore.getState().settings.haptics && 'vibrate' in navigator) navigator.vibrate(ms);
};
