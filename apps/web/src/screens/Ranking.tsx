import type { ProfileData, RankingPeriod, RankingRow } from '@buraco/protocol';
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { api } from '../net';
import { useStore } from '../store';
import { Page } from './HowTo';

export function Ranking() {
  const [period, setPeriod] = useState<RankingPeriod>('all');
  const [rows, setRows] = useState<RankingRow[] | null>(null);
  const setPage = useStore((s) => s.setPage);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    api
      .ranking(period)
      .then((r) => !cancelled && setRows(r))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [period]);

  return (
    <Page title={t.ranking}>
      <div className="mb-3 flex gap-2" role="tablist">
        {(['all', 'week', 'month'] as const).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={p === period}
            className={p === period ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setPeriod(p)}
          >
            {t.period[p]}
          </button>
        ))}
      </div>
      {rows === null ? (
        <p className="text-white/75">…</p>
      ) : rows.length === 0 ? (
        <p className="text-white/75">{t.noData}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-white/75">
            <tr>
              <th className="py-2">#</th>
              <th>Jogador</th>
              <th className="text-right">{t.wins}</th>
              <th className="text-right">{t.games}</th>
              <th className="text-right">%</th>
              <th className="text-right">{t.best}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name} className="border-t border-white/10">
                <td className="py-2">{i + 1}</td>
                <td>
                  <button
                    className="underline-offset-2 hover:underline"
                    onClick={() => setPage('profile', r.name)}
                  >
                    {r.name}
                  </button>
                </td>
                <td className="text-right font-bold">{r.wins}</td>
                <td className="text-right">{r.games}</td>
                <td className="text-right">{r.winRate}%</td>
                <td className="text-right">{r.bestScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}

export function Profile() {
  const { profileName, identity } = useStore();
  const name = profileName ?? identity?.name ?? '';
  const [data, setData] = useState<ProfileData | null | undefined>(undefined);

  useEffect(() => {
    api
      .profile(name)
      .then((r) => setData(r.ok ? r.data : null))
      .catch(() => setData(null));
  }, [name]);

  return (
    <Page title={`${t.profile}: ${name}`}>
      {data === undefined ? (
        <p className="text-white/75">…</p>
      ) : data === null ? (
        <p className="text-white/75">{t.noData}</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {[
              [t.wins, data.stats.wins],
              [t.games, data.stats.games],
              [t.winRate, `${data.stats.winRate}%`],
              [t.best, data.stats.bestScore],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-white/10 p-3 text-center">
                <div className="text-2xl font-extrabold">{v}</div>
                <div className="text-xs text-white/75">{k}</div>
              </div>
            ))}
          </div>
          <h2 className="mb-2 font-bold">{t.recent}</h2>
          {data.recent.length === 0 && <p className="text-white/75">{t.noData}</p>}
          <ul className="space-y-1">
            {data.recent.map((m) => (
              <li
                key={m.finishedAt}
                className="flex justify-between rounded-lg bg-white/10 px-3 py-2 text-sm"
              >
                <span className={m.won ? 'text-green-300' : 'text-red-300'}>
                  {m.won ? t.won : t.lost}
                </span>
                <span>{m.score} pts</span>
                <span className="text-white/75">
                  {m.numPlayers}p · {new Date(m.finishedAt).toLocaleDateString('pt-BR')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}
