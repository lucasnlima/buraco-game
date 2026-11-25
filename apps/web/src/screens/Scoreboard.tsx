import { teamOf } from '@buraco/engine';
import type { PlayerView } from '@buraco/engine';
import type { MatchSummary } from '@buraco/protocol';
import { Modal } from '../components';
import { t } from '../i18n';
import { badgeUrl } from '../theme';
import { useStore } from '../store';

export function teamNames(numPlayers: number, names: string[]): string[] {
  const teams = numPlayers === 4 ? 2 : numPlayers;
  return Array.from({ length: teams }, (_, tm) =>
    names.filter((_, i) => teamOf(numPlayers, i) === tm).join(' & '),
  );
}

export function Scoreboard({
  view,
  match,
  names,
  isHost,
  onClose,
}: {
  view: PlayerView;
  match: MatchSummary;
  names: string[];
  isHost: boolean;
  onClose?: () => void;
}) {
  const { send, leaveRoom } = useStore();
  const tn = teamNames(view.numPlayers, names);
  const result = view.status === 'ended' ? view.result : null;

  return (
    <Modal title={result ? t.handResult : t.scoreboard} onClose={result ? undefined : onClose}>
      {result && (
        <>
          <p className="mb-3 flex items-center justify-center gap-2 text-center font-semibold text-gold">
            {result.reason === 'out' && (
              <img src={badgeUrl('bateu')} alt="" width={40} height={40} />
            )}
            {result.reason === 'out' ? t.wentOut(names[result.outPlayer!] ?? '?') : t.exhausted}
          </p>
          <div className="mb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-white/75">
                <tr>
                  <th className="text-left"> </th>
                  {tn.map((n, i) => (
                    <th key={i} className="px-1 text-right">
                      {n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    [t.meldCards, (x: (typeof result.teams)[number]) => x.meldPoints],
                    [t.canastas, (x: (typeof result.teams)[number]) => x.canastaBonus],
                    [t.goOutBonus, (x: (typeof result.teams)[number]) => x.outBonus],
                    [t.noDeadPenalty, (x: (typeof result.teams)[number]) => -x.deadPenalty],
                    [t.handLeft, (x: (typeof result.teams)[number]) => -x.handPenalty],
                  ] as const
                ).map(([label, fn]) => (
                  <tr key={label} className="border-t border-white/10">
                    <td className="py-1">{label}</td>
                    {result.teams.map((x) => (
                      <td key={x.team} className="text-right">
                        {fn(x) > 0 ? `+${fn(x)}` : fn(x)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t-2 border-white/30 font-bold">
                  <td className="py-1">{t.total}</td>
                  {result.teams.map((x) => (
                    <td key={x.team} className="text-right">
                      {x.total}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="mb-1 font-bold">
        {t.accumulated}{' '}
        <span className="text-xs font-normal text-white/75">(meta {view.config.targetScore})</span>
      </h3>
      <div
        className="mb-3 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${tn.length}, minmax(0,1fr))` }}
      >
        {tn.map((n, i) => (
          <div
            key={i}
            className={`rounded-xl p-3 text-center ${i === view.yourTeam ? 'bg-gold/20 ring-1 ring-gold' : 'bg-white/10'}`}
          >
            <div className="truncate text-xs text-white/70">{n}</div>
            <div className="text-2xl font-extrabold" data-testid={`total-${i}`}>
              {match.totals[i]}
            </div>
          </div>
        ))}
      </div>

      {match.history.length > 0 && (
        <ul className="mb-3 space-y-1 text-xs text-white/70">
          {match.history.map((h, i) => (
            <li key={i} className="flex justify-between">
              <span>
                {t.hand} {i + 1}
              </span>
              <span>{h.teams.map((x) => x.total).join(' × ')}</span>
            </li>
          ))}
        </ul>
      )}

      {result && match.finished && (
        <p className="mb-3 flex items-center justify-center gap-2 text-center text-lg font-bold text-gold">
          <img src={badgeUrl('vitoria')} alt="" width={48} height={48} />
          {t.matchWinner(match.winners.map((w) => tn[w]).join(' / '))}
        </p>
      )}
      {result && (
        <div className="flex flex-col gap-2">
          {view.status === 'ended' &&
            !match.finished &&
            !(useStore.getState().lobby?.phase === 'abandoned') && (
              <button className="btn-primary" onClick={() => send({ t: 'nextHand' })}>
                {t.nextHand}
              </button>
            )}
          {isHost && (match.finished || useStore.getState().lobby?.phase === 'abandoned') && (
            <button className="btn-primary" onClick={() => send({ t: 'rematch' })}>
              {t.rematch}
            </button>
          )}
          <button className="btn-ghost" onClick={leaveRoom}>
            {t.leave}
          </button>
        </div>
      )}
    </Modal>
  );
}
