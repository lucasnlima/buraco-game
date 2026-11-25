import type { Config } from '@buraco/engine';
import { useState } from 'react';
import { Avatar, Icon } from '../components';
import { t } from '../i18n';
import { useStore } from '../store';
import { Panels } from './Panels';

export function Lobby() {
  const { lobby, myId, send, leaveRoom, say, code } = useStore();
  if (!lobby) return null;
  const isHost = lobby.hostId === myId;
  const n = lobby.players.length;
  const cfg = lobby.config;
  const set = (c: Partial<Config>) => send({ t: 'config', config: c });
  const link = `${location.origin}/?sala=${lobby.code}`;
  const [panel, setPanel] = useState(false);

  async function invite() {
    const text = t.inviteText(lobby!.code, link);
    if (navigator.share) {
      try {
        await navigator.share({ title: t.appName, text, url: link });
        return;
      } catch {
        /* cancelado */
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      say(t.copied);
    } catch {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
  }

  const seatOwner = (s: number) => lobby.players.find((p) => p.seat === s);
  const teamLabel = (s: number) => (n === 4 ? (s % 2 === 0 ? t.teamA : t.teamB) : '');

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 pb-8">
      <header className="flex items-center justify-between py-3">
        <button className="btn-ghost" onClick={leaveRoom}>
          <Icon name="exit" /> {t.leave}
        </button>
        <button className="btn-ghost" onClick={() => setPanel(true)} aria-label={t.chat}>
          <Icon name="chat" /> <Icon name="headphones" />
        </button>
      </header>

      <div className="mb-4 rounded-2xl bg-white/10 p-4 text-center">
        <div className="text-sm text-white/75">{t.roomCode}</div>
        <div className="text-4xl font-black tracking-[0.3em]" data-testid="room-code">
          {lobby.code}
        </div>
        <button className="btn-primary mt-3" onClick={invite}>
          <Icon name="share" /> {t.invite}
        </button>
      </div>

      <h2 className="mb-2 font-bold">{t.players}</h2>
      <div className="mb-1 grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((s) => {
          const p = seatOwner(s);
          return (
            <button
              key={s}
              className={`flex min-h-[64px] items-center gap-3 rounded-xl border p-2 text-left ${p ? 'border-white/20 bg-white/10' : 'border-dashed border-white/30'} ${
                p?.id === myId ? 'ring-2 ring-gold' : ''
              }`}
              disabled={!!p && p.id !== myId}
              onClick={() => !p && send({ t: 'seat', seat: s })}
              aria-label={`${t.seat} ${s + 1}`}
            >
              {p ? (
                <Avatar name={p.name} pick={p.avatar} />
              ) : (
                <div className="h-11 w-11 rounded-full bg-white/10" />
              )}
              <div className="min-w-0">
                <div className="truncate font-semibold">{p ? p.name : `${t.seat} ${s + 1}`}</div>
                <div className="text-xs text-white/75">
                  {p?.id === lobby.hostId && (
                    <>
                      <Icon name="crown" size={14} /> {t.hostBadge} ·{' '}
                    </>
                  )}
                  {p && !p.connected && '⚠ offline · '}
                  {p?.voice && <Icon name="headphones" size={14} />}
                  {teamLabel(s)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="mb-4 text-xs text-white/75">{t.partnersHint}</p>

      <h2 className="mb-2 font-bold">{t.rules}</h2>
      <div className="mb-4 space-y-2 rounded-2xl bg-white/10 p-3 text-sm">
        <Row label={t.cfg.targetScore}>
          <select
            disabled={!isHost}
            value={cfg.targetScore}
            onChange={(e) => set({ targetScore: Number(e.target.value) as Config['targetScore'] })}
            className="rounded-lg bg-white/90 px-2 py-2 text-black"
          >
            {[1500, 3000, 5000].map((v) => (
              <option key={v} value={v}>
                {v.toLocaleString('pt-BR')}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t.cfg.turnTimer}>
          <select
            disabled={!isHost}
            value={cfg.turnTimer}
            onChange={(e) => set({ turnTimer: Number(e.target.value) as Config['turnTimer'] })}
            className="rounded-lg bg-white/90 px-2 py-2 text-black"
          >
            <option value={0}>{t.cfg.off}</option>
            <option value={60}>60s</option>
            <option value={90}>90s</option>
          </select>
        </Row>
        <Row label={t.cfg.goOut}>
          <select
            disabled={!isHost}
            value={cfg.goOut}
            onChange={(e) => set({ goOut: e.target.value as Config['goOut'] })}
            className="rounded-lg bg-white/90 px-2 py-2 text-black"
          >
            <option value="both">{t.cfg.goOutBoth}</option>
            <option value="meld">{t.cfg.goOutMeld}</option>
            <option value="discard">{t.cfg.goOutDiscard}</option>
          </select>
        </Row>
        {(
          [
            'jokers',
            'acesTrinca',
            'wildReposition',
            'firstDrawRefusal',
            'dirtyCanastaToGoOut',
            'recycleDead',
          ] as const
        ).map((k) => (
          <Row key={k} label={t.cfg[k]}>
            <input
              type="checkbox"
              className="h-6 w-6"
              disabled={!isHost}
              checked={cfg[k]}
              onChange={(e) => set({ [k]: e.target.checked })}
            />
          </Row>
        ))}
      </div>

      {isHost ? (
        <>
          <button className="btn-primary" disabled={n < 2} onClick={() => send({ t: 'start' })}>
            ▶ {t.start}
          </button>
          {n < 2 && <p className="mt-2 text-center text-sm text-white/75">{t.needTwo}</p>}
        </>
      ) : (
        <p className="text-center text-white/70">{t.waitingHost}</p>
      )}
      <span className="sr-only">{code}</span>
      {panel && <Panels onClose={() => setPanel(false)} />}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-h-[44px] items-center justify-between gap-3">
      <span>{label}</span>
      {children}
    </label>
  );
}
