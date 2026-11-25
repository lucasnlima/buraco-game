import { REACTIONS } from '@buraco/protocol';
import { useEffect, useRef, useState } from 'react';
import { Avatar, Icon, Modal } from '../components';
import { t } from '../i18n';
import { useStore } from '../store';
import { useVoice, voice } from '../voice';

type Tab = 'chat' | 'voice' | 'settings';

export function Panels({ onClose, initial = 'chat' }: { onClose: () => void; initial?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial);
  const clearUnread = useStore((s) => s.clearUnread);
  useEffect(() => {
    if (tab === 'chat') clearUnread();
  }, [tab, clearUnread]);

  return (
    <Modal
      onClose={onClose}
      title={t[tab === 'chat' ? 'chat' : tab === 'voice' ? 'voice' : 'settings']}
    >
      <div className="mb-3 flex gap-2" role="tablist">
        {(['chat', 'voice', 'settings'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'btn-primary flex-1' : 'btn-ghost flex-1'}
            onClick={() => setTab(k)}
          >
            <Icon name={k === 'chat' ? 'chat' : k === 'voice' ? 'headphones' : 'settings'} />
          </button>
        ))}
      </div>
      {tab === 'chat' && <Chat />}
      {tab === 'voice' && <VoiceTab />}
      {tab === 'settings' && <SettingsTab />}
    </Modal>
  );
}

function Chat() {
  const { chat, send, myId } = useStore();
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [chat.length]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    send({ t: 'chat', text: text.trim() });
    setText('');
  }
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            className="btn-ghost !min-w-[44px] !px-2 text-xl"
            onClick={() => send({ t: 'react', emoji })}
            aria-label={`reagir ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div
        className="mb-2 h-48 overflow-y-auto rounded-xl bg-black/25 p-2 text-sm"
        aria-live="polite"
      >
        {chat.length === 0 && <p className="text-white/75">…</p>}
        {chat.map((m, i) => (
          <p key={i} className={m.from === myId ? 'text-gold' : ''}>
            <b>{m.name}:</b> {m.text}
          </p>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <input
          className="min-h-[44px] min-w-0 flex-1 rounded-xl bg-white px-3 text-black"
          value={text}
          maxLength={200}
          placeholder={t.typeMessage}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn-primary">{t.send}</button>
      </form>
    </div>
  );
}

function VoiceTab() {
  const v = useVoice();
  const { lobby, myId } = useStore();
  const others = lobby?.players.filter((p) => p.id !== myId && p.voice) ?? [];
  return (
    <div className="space-y-3">
      {v.error && <p className="rounded-lg bg-red-600/80 px-3 py-2 text-sm">{v.error}</p>}
      {!v.active ? (
        <button
          className="btn-primary w-full"
          disabled={v.starting}
          onClick={() => void voice.start()}
        >
          <Icon name="mic-on" /> {t.joinVoice}
        </button>
      ) : (
        <>
          <div className="flex gap-2">
            <button
              className={v.muted ? 'btn-danger flex-1' : 'btn-ghost flex-1'}
              onClick={() => voice.setMuted(!v.muted)}
            >
              <Icon name={v.muted ? 'mic-off' : 'mic-on'} /> {v.muted ? t.unmute : t.mute}
            </button>
            <button className="btn-ghost flex-1" onClick={() => voice.stop()}>
              {t.leaveVoice}
            </button>
          </div>
          <label className="flex min-h-[44px] items-center justify-between">
            <span>{t.ptt}</span>
            <input
              type="checkbox"
              className="h-6 w-6"
              checked={v.ptt}
              onChange={(e) => voice.setPtt(e.target.checked)}
            />
          </label>
          {v.ptt && (
            <button
              className={`w-full select-none rounded-xl py-5 text-lg font-bold ${v.pttHeld ? 'bg-green-500 text-black' : 'bg-white/15'}`}
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                voice.setPttHeld(true);
              }}
              onPointerUp={() => voice.setPttHeld(false)}
              onPointerCancel={() => voice.setPttHeld(false)}
            >
              <Icon name="mic-on" /> {t.pttHold}
            </button>
          )}
        </>
      )}
      <h3 className="pt-2 text-sm font-semibold text-white/70">{t.voice}</h3>
      {others.length === 0 && <p className="text-sm text-white/75">—</p>}
      {others.map((p) => (
        <div key={p.id} className="flex items-center gap-3">
          <Avatar name={p.name} size={36} speaking={!!v.speaking[p.id]} />
          <span className="w-24 truncate">{p.name}</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={v.volumes[p.id] ?? 1}
            aria-label={`${t.volume} ${p.name}`}
            className="h-8 flex-1"
            onChange={(e) => voice.setVolume(p.id, Number(e.target.value))}
          />
        </div>
      ))}
    </div>
  );
}

function SettingsTab() {
  const { settings, updateSettings } = useStore();
  return (
    <div className="space-y-2">
      <label className="flex min-h-[44px] items-center justify-between">
        <span>{t.fourColors}</span>
        <input
          type="checkbox"
          className="h-6 w-6"
          checked={settings.fourColors}
          onChange={(e) => updateSettings({ fourColors: e.target.checked })}
        />
      </label>
      <label className="flex min-h-[44px] items-center justify-between">
        <span>{t.haptics}</span>
        <input
          type="checkbox"
          className="h-6 w-6"
          checked={settings.haptics}
          onChange={(e) => updateSettings({ haptics: e.target.checked })}
        />
      </label>
    </div>
  );
}
