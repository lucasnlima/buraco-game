import {
  type Card,
  type Meld,
  arrangements,
  canastaType,
  cardCode,
  resolveAddition,
  resolveNewMeld,
  teamOf,
} from '@buraco/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, CardView, Icon, Modal } from '../components';
import { t } from '../i18n';
import { buzz, useStore } from '../store';
import { badgeUrl } from '../theme';
import { useVoice } from '../voice';
import { Panels } from './Panels';
import { Scoreboard, teamNames } from './Scoreboard';

const SUIT_ORDER = { S: 0, H: 1, D: 2, C: 3 } as const;

function sortHand(hand: Card[], mode: 'suit' | 'rank'): Card[] {
  const s = hand.slice();
  const key = (c: Card) => (c.suit ? SUIT_ORDER[c.suit] : 9);
  s.sort(
    mode === 'suit'
      ? (a, b) => key(a) - key(b) || a.rank - b.rank || a.id - b.id
      : (a, b) => a.rank - b.rank || key(a) - key(b) || a.id - b.id,
  );
  return s;
}

function useCompact(): boolean {
  const [c, setC] = useState(() => window.innerHeight < 520);
  useEffect(() => {
    const f = () => setC(window.innerHeight < 520);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return c;
}

function useCountdown(deadline: number | null): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}

export function Table() {
  const { game, lobby, myId, send, say, settings, unread, reactions, leaveRoom } = useStore();
  const speaking = useVoice((s) => s.speaking);
  const compact = useCompact();
  const [sel, setSel] = useState<number[]>([]);
  const [panel, setPanel] = useState<null | 'chat' | 'voice'>(null);
  const [showScore, setShowScore] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [wildChoice, setWildChoice] = useState<number[] | null>(null);
  const [drag, setDrag] = useState<{ ids: number[]; x: number; y: number } | null>(null);
  const countdown = useCountdown(game?.deadline ?? null);

  // Mantém a tela acesa durante a partida
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const req = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        /* não suportado */
      }
    };
    void req();
    const vis = () => document.visibilityState === 'visible' && void req();
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      void lock?.release();
    };
  }, []);

  const view = game?.view;
  const hand = useMemo(
    () => (view ? sortHand(view.myHand, settings.sort) : []),
    [view, settings.sort],
  );
  const handIds = useMemo(() => new Set(hand.map((c) => c.id)), [hand]);
  const selected = useMemo(() => sel.filter((id) => handIds.has(id)), [sel, handIds]);
  const selCards = useMemo(() => hand.filter((c) => selected.includes(c.id)), [hand, selected]);

  const dragRef = useRef<{
    id: number;
    x: number;
    y: number;
    type: string;
    active: boolean;
  } | null>(null);

  if (!game || !lobby || !view) return null;
  const { match, deadline } = game;
  void deadline;
  const names = lobby.order.map((id) => lobby.players.find((p) => p.id === id)?.name ?? '?');
  const me = view.you;
  const n = view.numPlayers;
  const myTurn = view.status === 'playing' && view.turn === me;
  const cfg = view.config;
  const isHost = lobby.hostId === myId;
  const tn = teamNames(n, names);
  const small = compact ? 38 : 50;

  const canMeld = selCards.length >= 3 && !!resolveNewMeld(selCards, cfg);
  const wildPositions = canMeld
    ? [
        ...new Set(
          arrangements(selCards)
            .map((l) => l.slots.find((s) => s.wild)?.pos)
            .filter((p): p is number => p !== undefined),
        ),
      ]
    : [];

  const act = (a: Parameters<typeof send>[0]) => {
    send(a);
    buzz(15);
  };
  const clearSel = () => setSel([]);

  function doMeld(wildPos?: number) {
    act({
      t: 'game',
      action: { type: 'MELD', cardIds: selected, ...(wildPos ? { wildPos } : {}) },
    });
    clearSel();
    setWildChoice(null);
  }
  function onMeldClick() {
    if (wildPositions.length > 1) setWildChoice(wildPositions.sort((a, b) => b - a));
    else doMeld();
  }
  function tapMeld(m: Meld, ids = selected) {
    if (!myTurn || view!.phase !== 'play')
      return say(myTurn ? t.phase.draw + '!' : t.turnOf(names[view!.turn] ?? ''));
    if (m.team !== view!.yourTeam || ids.length === 0) return;
    act({ t: 'game', action: { type: 'ADD_TO_MELD', meldId: m.id, cardIds: ids } });
    clearSel();
  }
  function tapStock() {
    if (!myTurn) return say(t.turnOf(names[view!.turn] ?? ''));
    if (view!.phase !== 'draw') return;
    act({ t: 'game', action: { type: 'DRAW_STOCK' } });
  }
  function tapDiscard() {
    if (!myTurn) return setShowDiscard(true);
    if (view!.phase === 'draw' && view!.discard.length)
      act({ t: 'game', action: { type: 'TAKE_DISCARD' } });
    else setShowDiscard(true);
  }
  function doDiscard(id: number) {
    act({ t: 'game', action: { type: 'DISCARD', cardId: id } });
    clearSel();
  }

  // ── Arrastar e soltar por ponteiro (funciona em toque e mouse) ──
  function onCardPointerDown(e: React.PointerEvent, c: Card) {
    dragRef.current = { id: c.id, x: e.clientX, y: e.clientY, type: e.pointerType, active: false };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      if (!d.active) {
        const start =
          d.type === 'mouse'
            ? Math.hypot(dx, dy) > 8
            : Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx);
        if (!start) return;
        d.active = true;
        const ids = selected.includes(d.id) ? selected : [d.id];
        setDrag({ ids, x: ev.clientX, y: ev.clientY });
      } else setDrag((g) => (g ? { ...g, x: ev.clientX, y: ev.clientY } : g));
    };
    const finish = (ev: PointerEvent, cancelled: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (!d.active) {
        if (!cancelled && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 10) {
          setSel((s) => (s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id]));
          buzz(8);
        }
        return;
      }
      setDrag(null);
      if (cancelled) return;
      const target = (
        document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      )?.closest<HTMLElement>('[data-drop]');
      const drop = target?.dataset.drop;
      const st = useStore.getState().game?.view;
      if (!drop || !st) return;
      const ids = selected.includes(d.id) ? selected : [d.id];
      if (drop === 'discard') {
        if (ids.length !== 1) return say('Arraste uma carta por vez para o lixo.');
        if (st.turn !== st.you || st.phase !== 'play')
          return say(st.turn === st.you ? 'Compre antes de descartar.' : 'Não é a sua vez.');
        doDiscard(ids[0]!);
      } else if (drop.startsWith('meld:')) {
        const m = st.melds.find((x) => x.id === Number(drop.slice(5)));
        if (m) tapMeld(m, ids);
      }
    };
    const up = (ev: PointerEvent) => finish(ev, false);
    const cancel = (ev: PointerEvent) => finish(ev, true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  // ── Renderização ──
  const opponents = Array.from({ length: n - 1 }, (_, k) => (me + 1 + k) % n);
  const myMelds = view.melds.filter((m) => m.team === view.yourTeam);
  const theirMelds = view.melds.filter((m) => m.team !== view.yourTeam);
  const phaseChips: [string, boolean][] = [
    [t.phase.draw, view.phase === 'draw'],
    [t.phase.meld, view.phase === 'play'],
    [t.phase.discard, view.phase === 'play'],
  ];
  const reactionOf = (id: string) => reactions.filter((r) => r.from === id);
  const myScore = match.totals[view.yourTeam] ?? 0;

  return (
    <div className="flex h-full flex-col" style={{ background: 'rgba(5,30,20,0.28)' }}>
      {/* Cabeçalho */}
      <header className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
        <button
          className="btn-ghost !min-h-[44px] !px-3"
          onClick={() => setShowScore(true)}
          aria-label={t.scoreboard}
        >
          <Icon name="trophy" size={20} /> <span data-testid="my-score">{myScore}</span>
        </button>
        <div className="text-center leading-tight">
          <div className="font-bold" data-testid="turn-label">
            {view.status === 'ended'
              ? '—'
              : myTurn
                ? `⭐ ${t.yourTurn}`
                : t.turnOf(names[view.turn] ?? '')}
          </div>
          <div className="text-white/75">
            {t.hand} {match.handNumber} · {lobby.code}
            {countdown !== null && (
              <span className={countdown <= 10 ? ' font-bold text-red-300' : ''}>
                {' '}
                · <Icon name="timer" size={12} /> {countdown}s
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          <button
            className="btn-ghost relative !min-h-[44px] !min-w-[44px] !px-2"
            onClick={() => setPanel('chat')}
            aria-label={t.chat}
          >
            <Icon name="chat" size={22} />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1 text-[10px]">
                {unread}
              </span>
            )}
          </button>
          <button
            className="btn-ghost !min-h-[44px] !min-w-[44px] !px-2"
            onClick={() => setPanel('voice')}
            aria-label={t.voice}
          >
            <Icon name="headphones" size={22} />
          </button>
        </div>
      </header>

      {/* Adversários */}
      <div className="flex justify-around gap-1 px-2 py-1">
        {opponents.map((i) => {
          const pid = lobby.order[i]!;
          const pl = lobby.players.find((p) => p.id === pid);
          const isTurn = view.turn === i && view.status === 'playing';
          return (
            <div
              key={i}
              className={`relative flex min-w-0 flex-1 flex-col items-center rounded-xl p-1 ${isTurn ? 'bg-gold/25 ring-2 ring-gold' : 'bg-black/20'}`}
              data-testid={`opp-${i}`}
            >
              <Avatar name={names[i] ?? '?'} size={compact ? 28 : 38} speaking={!!speaking[pid]} />
              <div className="max-w-full truncate text-xs font-semibold">
                {names[i]}{' '}
                {n === 4 && teamOf(n, i) === view.yourTeam && (
                  <span className="text-gold">({t.partner})</span>
                )}
              </div>
              <div className="text-[11px] text-white/70">
                🂠 {view.handCounts[i]} {pl && !pl.connected && '⚠'}
              </div>
              {reactionOf(pid).map((r) => (
                <span key={r.key} className="float-up pointer-events-none absolute -top-1 text-2xl">
                  {r.emoji}
                </span>
              ))}
            </div>
          );
        })}
      </div>

      {/* Jogos baixados */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2" data-testid="melds-area">
        <MeldRow
          title={t.yourMelds}
          melds={myMelds}
          mine
          selCards={selCards}
          cfg={cfg}
          onTap={tapMeld}
        />
        {theirMelds.length > 0 && (
          <MeldRow
            title={t.theirMelds}
            melds={theirMelds}
            selCards={[]}
            cfg={cfg}
            onTap={() => {}}
          />
        )}
      </div>

      {/* Centro: monte, lixo, mortos */}
      <div className="flex items-end justify-center gap-4 px-2 py-1">
        <button
          className={`flex flex-col items-center ${myTurn && view.phase === 'draw' ? 'animate-pulse' : ''}`}
          onClick={tapStock}
          aria-label={t.stock}
          data-testid="stock"
        >
          <CardView faceDown w={compact ? 34 : 44} />
          <span className="text-[11px] text-white/70">
            {t.stock} · {view.stockCount}
          </span>
        </button>
        <button
          className={`flex flex-col items-center rounded-lg p-1 ${drag ? 'bg-white/20 ring-2 ring-gold' : ''}`}
          data-drop="discard"
          onClick={tapDiscard}
          aria-label={t.discardPile}
          data-testid="discard"
        >
          {view.discard.length ? (
            <CardView card={view.discard[view.discard.length - 1]!} w={compact ? 34 : 44} />
          ) : (
            <div
              className="rounded-md border-2 border-dashed border-white/30"
              style={{ width: compact ? 34 : 44, height: compact ? 48 : 62 }}
            />
          )}
          <span className="text-[11px] text-white/70">
            {t.discardPile} · {view.discard.length}
          </span>
        </button>
        <div className="flex flex-col items-center gap-0.5 text-[11px] text-white/70">
          {view.deadCounts.map((c, tm) => (
            <span key={tm} className={tm === view.yourTeam ? 'text-gold' : ''}>
              {t.dead}{' '}
              {n === 4 || n === 2
                ? tm === view.yourTeam
                  ? '(você)'
                  : ''
                : `(${tn[tm]?.split(' ')[0] ?? ''})`}
              : {view.deadTaken[tm] ? t.deadTaken : c ? `${c} 🂠` : '—'}
            </span>
          ))}
          <button
            className="btn-ghost !min-h-[32px] !px-2 text-[11px]"
            onClick={() => setShowDiscard(true)}
          >
            <Icon name="discard-pile" size={16} /> {t.viewDiscard}
          </button>
        </div>
      </div>

      {/* Fase */}
      <div className="flex items-center justify-center gap-1 px-2 text-[11px]">
        {phaseChips.map(([label, active], i) => (
          <span
            key={i}
            className={`rounded-full px-2 py-0.5 ${myTurn && active ? 'bg-gold font-bold text-black' : 'bg-black/30 text-white/75'}`}
          >
            {i + 1}. {label}
          </span>
        ))}
      </div>

      {/* Mão em leque */}
      <div
        className="flex overflow-x-auto px-3 pb-1 pt-4"
        style={{ touchAction: 'pan-x' }}
        data-testid="hand"
      >
        {hand.map((c, i) => (
          <div
            key={c.id}
            data-card-id={c.id}
            data-code={cardCode(c)}
            onPointerDown={(e) => onCardPointerDown(e, c)}
            className="shrink-0 cursor-grab"
            style={{
              marginLeft: i === 0 ? 0 : -Math.round(small * 0.46),
              touchAction: 'pan-x',
              zIndex: selected.includes(c.id) ? 20 : i,
            }}
          >
            <CardView
              card={c}
              w={small}
              selected={selected.includes(c.id)}
              dim={drag?.ids.includes(c.id)}
            />
          </div>
        ))}
      </div>

      {/* Ações */}
      <div
        className="flex flex-wrap items-center justify-center gap-2 px-2 pt-1"
        style={{ paddingBottom: 'calc(8px + var(--safe-bottom))' }}
      >
        <button
          className="btn-ghost !min-h-[44px] text-sm"
          onClick={() =>
            useStore.getState().updateSettings({ sort: settings.sort === 'suit' ? 'rank' : 'suit' })
          }
        >
          <Icon name={settings.sort === 'suit' ? 'sort-suit' : 'sort-rank'} size={20} />{' '}
          {settings.sort === 'suit' ? t.sortSuit : t.sortRank}
        </button>
        {selected.length > 0 && (
          <button className="btn-ghost !min-h-[44px] text-sm" onClick={clearSel}>
            <Icon name="undo-selection" size={20} /> {selected.length}
          </button>
        )}
        {myTurn && view.canRefuseDraw && (
          <button
            className="btn-ghost !min-h-[44px] text-sm"
            onClick={() => act({ t: 'game', action: { type: 'REJECT_DRAW' } })}
          >
            ↩ {t.refuse}
          </button>
        )}
        {myTurn && view.phase === 'play' && (
          <>
            <button
              className="btn-primary"
              disabled={!canMeld}
              onClick={onMeldClick}
              data-testid="meld-btn"
            >
              {t.meld}
            </button>
            <button
              className="btn-danger"
              disabled={selected.length !== 1}
              onClick={() => doDiscard(selected[0]!)}
              data-testid="discard-btn"
            >
              {t.discard}
            </button>
          </>
        )}
        {!myTurn && view.status === 'playing' && selected.length === 0 && (
          <span className="text-xs text-white/75">{t.selectCards}</span>
        )}
      </div>

      {/* Carta sendo arrastada */}
      {drag && (
        <div
          className="pointer-events-none fixed z-[70]"
          style={{ left: drag.x - 26, top: drag.y - 50 }}
        >
          <div className="relative">
            <CardView card={hand.find((c) => c.id === drag.ids[0])} w={52} selected />
            {drag.ids.length > 1 && (
              <span className="absolute -right-2 -top-2 rounded-full bg-gold px-1.5 text-xs font-bold text-black">
                {drag.ids.length}
              </span>
            )}
          </div>
        </div>
      )}

      {wildChoice && (
        <Modal title={t.wildWhere} onClose={() => setWildChoice(null)}>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={() => doMeld(wildChoice[0])}>
              {t.wildTop}
            </button>
            <button
              className="btn-primary flex-1"
              onClick={() => doMeld(wildChoice[wildChoice.length - 1])}
            >
              {t.wildBottom}
            </button>
          </div>
        </Modal>
      )}

      {showDiscard && (
        <Modal
          title={`${t.discardPile} (${view.discard.length})`}
          onClose={() => setShowDiscard(false)}
        >
          <div className="flex flex-wrap gap-1">
            {view.discard.length === 0 && <p className="text-white/75">—</p>}
            {view.discard.map((c) => (
              <CardView key={c.id} card={c} w={42} />
            ))}
          </div>
          {myTurn && view.phase === 'draw' && view.discard.length > 0 && (
            <button
              className="btn-primary mt-3 w-full"
              onClick={() => {
                setShowDiscard(false);
                act({ t: 'game', action: { type: 'TAKE_DISCARD' } });
              }}
            >
              Pegar o lixo inteiro
            </button>
          )}
        </Modal>
      )}

      {(showScore || view.status === 'ended') && lobby.phase !== 'abandoned' && (
        <Scoreboard
          view={view}
          match={match}
          names={names}
          isHost={isHost}
          onClose={() => setShowScore(false)}
        />
      )}

      {lobby.phase === 'abandoned' && (
        <Modal title={t.abandoned}>
          <div className="flex flex-col gap-2">
            {isHost && (
              <button className="btn-primary" onClick={() => send({ t: 'rematch' })}>
                {t.rematch}
              </button>
            )}
            <button className="btn-ghost" onClick={leaveRoom}>
              {t.leave}
            </button>
          </div>
        </Modal>
      )}

      {lobby.pendingDecision && isHost && lobby.phase !== 'abandoned' && (
        <Modal
          title={t.decisionTitle(
            lobby.players.find((p) => p.id === lobby.pendingDecision)?.name ?? '?',
          )}
        >
          <div className="flex gap-2">
            <button
              className="btn-primary flex-1"
              onClick={() => send({ t: 'decision', wait: true })}
            >
              {t.wait}
            </button>
            <button
              className="btn-danger flex-1"
              onClick={() => send({ t: 'decision', wait: false })}
            >
              {t.endMatch}
            </button>
          </div>
        </Modal>
      )}

      {panel && <Panels initial={panel} onClose={() => setPanel(null)} />}
    </div>
  );
}

function MeldRow({
  title,
  melds,
  mine = false,
  selCards,
  cfg,
  onTap,
}: {
  title: string;
  melds: Meld[];
  mine?: boolean;
  selCards: Card[];
  cfg: Parameters<typeof resolveAddition>[2];
  onTap: (m: Meld) => void;
}) {
  return (
    <section className="mb-1">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-white/75">{title}</h3>
      {melds.length === 0 ? (
        <p className="py-1 text-xs text-white/75">{t.noMelds}</p>
      ) : (
        <div className="flex flex-wrap gap-2 py-1">
          {melds.map((m) => {
            const accepts = mine && selCards.length > 0 && !!resolveAddition(m, selCards, cfg);
            const canasta = canastaType(m);
            return (
              <button
                key={m.id}
                data-drop={mine ? `meld:${m.id}` : undefined}
                data-testid={`meld-${m.id}`}
                onClick={() => onTap(m)}
                className={`relative flex rounded-lg p-1 pt-4 ${accepts ? 'animate-pulse bg-gold/30 ring-2 ring-gold' : 'bg-black/25'}`}
                aria-label={`${t.melds} ${m.id}`}
              >
                {canasta && (
                  <span
                    className={`absolute -top-1 left-1 z-10 flex items-center gap-0.5 rounded px-1 text-[9px] font-bold ${canasta === 'suja' ? 'bg-orange-500' : 'bg-emerald-500'} text-black`}
                  >
                    <img
                      src={badgeUrl(
                        canasta === 'meia_real' ? 'canastra-real' : `canastra-${canasta}`,
                      )}
                      alt=""
                      width={14}
                      height={14}
                    />
                    {t.canasta[canasta]}
                  </span>
                )}
                {m.slots.map((s, i) => (
                  <div key={s.card.id} style={{ marginLeft: i === 0 ? 0 : -18 }}>
                    <CardView card={s.card} w={34} badge={s.wild ? 'C' : undefined} />
                  </div>
                ))}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
