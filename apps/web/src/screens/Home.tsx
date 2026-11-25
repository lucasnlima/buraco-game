import { useEffect, useState } from 'react';
import { assetUrl } from '../assets';
import { Icon } from '../components';
import { t } from '../i18n';
import { useStore } from '../store';

export function Home() {
  const { identity, setName, createRoom, joinRoom, setPage, startLocal } = useStore();
  const [bots, setBots] = useState(1);
  const localOnly = import.meta.env.VITE_LOCAL_ONLY === '1';
  const [name, setNameInput] = useState(identity?.name ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invite = new URLSearchParams(location.search).get('sala');
  useEffect(() => {
    if (invite) setCode(invite.toUpperCase().slice(0, 5));
  }, [invite]);

  const valid = name.trim().length >= 2 && name.trim().length <= 20;

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const err = await setName(name).then((e) => e ?? fn());
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-5 pb-8">
      <div className="text-center">
        <img
          src={assetUrl('/assets/brand/logo.webp')}
          alt=""
          width={260}
          height={146}
          className="mx-auto mb-2 w-64 max-w-full rounded-3xl shadow-lg"
        />
        <h1 className="sr-only">{t.appName}</h1>
        <p className="text-white/80">{t.tagline}</p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3">
        <label className="text-sm text-white/80" htmlFor="name">
          {t.yourName} <span className="text-white/75">({t.nameHint})</span>
        </label>
        <input
          id="name"
          className="min-h-[48px] rounded-xl bg-white px-4 text-lg text-black outline-none focus:ring-2 focus:ring-gold"
          value={name}
          maxLength={20}
          autoComplete="nickname"
          onChange={(e) => setNameInput(e.target.value)}
        />
        {!localOnly && (
          <button className="btn-primary" disabled={!valid || busy} onClick={() => run(createRoom)}>
            {t.createRoom}
          </button>
        )}
        <div className="flex gap-2">
          <button
            className={localOnly ? 'btn-primary min-w-0 flex-1' : 'btn-ghost min-w-0 flex-1'}
            disabled={!valid}
            data-testid="play-local"
            onClick={() => setError(startLocal(name, bots))}
          >
            {t.trainVsComputer}
          </button>
          <select
            aria-label={t.opponents}
            value={bots}
            onChange={(e) => setBots(Number(e.target.value))}
            className="rounded-xl bg-white/90 px-2 text-black"
          >
            <option value={1}>1 {t.opponent}</option>
            <option value={2}>2 {t.opponents3}</option>
            <option value={3}>3 ({t.partnerShort})</option>
          </select>
        </div>
        {!localOnly && (
          <div className="flex gap-2">
            <input
              aria-label={t.roomCode}
              placeholder={t.roomCode}
              className="min-h-[48px] min-w-0 flex-1 rounded-xl bg-white px-4 text-center text-lg uppercase tracking-widest text-black outline-none focus:ring-2 focus:ring-gold"
              value={code}
              maxLength={5}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button
              className="btn-ghost"
              disabled={!valid || code.length < 5 || busy}
              onClick={() => run(() => joinRoom(code))}
            >
              {t.join}
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-red-600/80 px-3 py-2 text-sm">
            {error}
          </p>
        )}
      </div>
      {!localOnly && (
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setPage('ranking')}>
            <Icon name="trophy" /> {t.ranking}
          </button>
          {identity && (
            <button className="btn-ghost" onClick={() => setPage('profile', identity.name)}>
              <Icon name="crown" /> {t.profile}
            </button>
          )}
          <button className="btn-ghost" onClick={() => setPage('howto')}>
            <Icon name="rules-book" /> {t.howTo}
          </button>
        </div>
      )}
      {localOnly && (
        <button className="btn-ghost" onClick={() => setPage('howto')}>
          <Icon name="rules-book" /> {t.howTo}
        </button>
      )}
      <p className="max-w-xs text-center text-xs text-white/75">{t.installHint}</p>
    </div>
  );
}
