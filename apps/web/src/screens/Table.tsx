import {
  type Card,
  type Meld,
  type Suit,
  arrangements,
  canastaType,
  cardCode,
  resolveAddition,
  resolveNewMeld,
  teamOf,
} from '@buraco/engine';
import { type Key, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, CardView, Icon, Modal } from '../components';
import { t } from '../i18n';
import { buzz, useStore } from '../store';
import { badgeUrl, deckBack } from '../theme';
import { useVoice } from '../voice';
import { Panels } from './Panels';
import { Scoreboard } from './Scoreboard';
import { TableFx } from './TableFx';

/**
 * Ordem dos naipes intercalando as cores: ouros, paus, copas, espadas. Se faltar um naipe na mão,
 * rearranja os outros para dois da mesma cor não ficarem lado a lado.
 */
function suitOrder(hand: Card[]): Suit[] {
  const has = (s: Suit) => hand.some((c) => c.suit === s);
  const red = (['D', 'H'] as const).filter(has);
  const black = (['C', 'S'] as const).filter(has);
  const [first, second]: Suit[][] = black.length > red.length ? [black, red] : [red, black];
  return [first![0], second![0], first![1], second![1]].filter((s): s is Suit => !!s);
}

function sortHand(hand: Card[], mode: 'suit' | 'rank'): Card[] {
  const s = hand.slice();
  const order = suitOrder(hand);
  const key = (c: Card) => (c.suit ? order.indexOf(c.suit) : 9);
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
  const { game, lobby, myId, send, say, settings, unread, reactions, leaveRoom, fresh } =
    useStore();
  const speaking = useVoice((s) => s.speaking);
  const compact = useCompact();
  const [sel, setSel] = useState<number[]>([]);
  const [panel, setPanel] = useState<null | 'chat' | 'voice' | 'settings'>(null);
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

  // A carta comprada pode ficar fora da parte visível da mão: rola até ela
  const freshKey = fresh.join();
  useEffect(() => {
    const first = freshKey.split(',')[0];
    if (first)
      document
        .querySelector(`[data-card-id="${first}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [freshKey]);

  if (!game || !lobby || !view) return null;
  const { match, deadline } = game;
  void deadline;
  const names = lobby.order.map((id) => lobby.players.find((p) => p.id === id)?.name ?? '?');
  const me = view.you;
  const n = view.numPlayers;
  const myTurn = view.status === 'playing' && view.turn === me;
  const cfg = view.config;
  const isHost = lobby.hostId === myId;
  const small = compact ? 38 : 50;
  const pileW = compact ? 34 : 46;
  const pileH = Math.round(pileW * 1.4);
  const deadLeft = view.deadCounts.flatMap((c, tm) => (c > 0 && !view.deadTaken[tm] ? [tm] : []));
  const discardW = compact ? 34 : 42;
  // Mostra as cartas do topo; passando do limite, o restante fica em "ver lixo"
  const discardLimit = window.innerWidth >= 640 ? 12 : 6;
  const hiddenDiscard = Math.max(0, view.discard.length - discardLimit);
  const shownDiscard = view.discard.slice(hiddenDiscard);
  const canTake = myTurn && view.phase === 'draw' && view.discard.length > 0;

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
    if (canTake) act({ t: 'game', action: { type: 'TAKE_DISCARD' } });
    else if (hiddenDiscard > 0) setShowDiscard(true);
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
  const reactionOf = (id: string) => reactions.filter((r) => r.from === id);
  const myScore = match.totals[view.yourTeam] ?? 0;

  // Posições na mesa: eu embaixo; os demais à esquerda, em cima e à direita.
  // Em telas baixas não há altura para as laterais, então todos vão para cima.
  const [left, top, right] = compact
    ? [undefined, undefined, undefined]
    : n === 2
      ? [undefined, opponents[0], undefined]
      : n === 3
        ? [opponents[0], undefined, opponents[1]]
        : [opponents[0], opponents[1], opponents[2]];
  const topRow = compact ? opponents : top === undefined ? [] : [top];
  const seat = (i: number, side: SeatSide) => {
    const pid = lobby.order[i]!;
    const pl = lobby.players.find((p) => p.id === pid);
    return (
      <OpponentSeat
        key={i}
        index={i}
        side={side}
        small={compact}
        name={names[i] ?? '?'}
        avatar={pl?.avatar}
        cards={view.handCounts[i] ?? 0}
        partner={n === 4 && teamOf(n, i) === view.yourTeam}
        isTurn={view.turn === i && view.status === 'playing'}
        offline={!!pl && !pl.connected}
        speaking={!!speaking[pid]}
        reactions={reactionOf(pid)}
      />
    );
  };

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
        <div className="min-w-0 flex-1 text-center leading-tight">
          <div className="truncate font-bold" data-testid="turn-label">
            {view.status === 'ended'
              ? '—'
              : myTurn
                ? `⭐ ${t.yourTurn}`
                : t.turnOf(names[view.turn] ?? '')}
          </div>
          <div className="text-white/75">
            {t.hand} {match.handNumber} · {lobby.code === 'LOCAL' ? 'Treino' : lobby.code}
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
            className="btn-ghost !min-h-[44px] !min-w-[44px] flex-col !gap-0 !px-1 text-[10px] leading-none"
            onClick={() =>
              useStore
                .getState()
                .updateSettings({ sort: settings.sort === 'suit' ? 'rank' : 'suit' })
            }
            data-testid="sort-btn"
          >
            <Icon name={settings.sort === 'suit' ? 'sort-suit' : 'sort-rank'} size={20} />
            {settings.sort === 'suit' ? t.sortSuit : t.sortRank}
          </button>
          {lobby.code === 'LOCAL' ? (
            <>
              <button
                className="btn-ghost !min-h-[44px] !min-w-[44px] !px-2"
                onClick={() => setPanel('settings')}
                aria-label={t.settings}
              >
                <Icon name="settings" size={22} />
              </button>
              <button
                className="btn-ghost !min-h-[44px] !min-w-[44px] !px-2"
                onClick={leaveRoom}
                aria-label={t.leave}
              >
                <Icon name="exit" size={22} />
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </header>

      {/* Adversário de cima (em telas baixas, todos) */}
      {topRow.length > 0 && (
        <div className="flex justify-center gap-2 px-2 py-0.5">
          {topRow.map((i) => seat(i, 'top'))}
        </div>
      )}

      {/* Laterais + jogos dos adversários (acima do centro) */}
      <div className={`flex min-h-0 ${compact && theirMelds.length === 0 ? 'hidden' : 'flex-1'}`}>
        {left !== undefined && seat(left, 'left')}
        <div className="min-w-0 flex-1 overflow-y-auto px-1" data-testid="their-melds-area">
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
        {right !== undefined && seat(right, 'right')}
      </div>

      {/* Centro: monte, mortos e lixo numa faixa só */}
      <div
        className="mx-1 flex shrink-0 items-center gap-1 rounded-xl bg-black/20 px-1 py-1"
        data-testid="table-center"
      >
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <button
            className={`flex flex-col items-center text-[11px] leading-tight text-white/90 ${myTurn && view.phase === 'draw' ? 'animate-pulse' : ''}`}
            onClick={tapStock}
            aria-label={t.stock}
            data-testid="stock"
          >
            <div data-fx="stock">
              <CardView faceDown back={deckBack(view.stockCount)} w={pileW} />
            </div>
            <span className="font-semibold">{t.stock}</span>
            <span>{view.stockCount}</span>
          </button>
          <div
            className={`flex flex-col items-center rounded-lg p-1 text-[11px] leading-tight ${drag ? 'bg-white/20 ring-2 ring-gold' : canTake ? 'bg-gold/15 ring-2 ring-gold' : ''}`}
            data-drop="discard"
            data-testid="discard"
          >
            <div className="flex items-center gap-1">
              {hiddenDiscard > 0 && (
                <button
                  className="flex flex-col items-center justify-center rounded-md bg-white/10 text-xs font-bold"
                  style={{ width: 28, height: Math.round(discardW * 1.4) }}
                  onClick={() => setShowDiscard(true)}
                  aria-label={t.viewDiscard}
                  data-testid="view-discard"
                >
                  <Icon name="discard-pile" size={18} />+{hiddenDiscard}
                </button>
              )}
              <button className="flex" onClick={tapDiscard} aria-label={t.discardPile}>
                {shownDiscard.length ? (
                  shownDiscard.map((c, i) => (
                    <div
                      key={c.id}
                      data-discard-id={c.id}
                      style={{ marginLeft: i === 0 ? 0 : -Math.round(discardW / 2) }}
                    >
                      <CardView card={c} w={discardW} />
                    </div>
                  ))
                ) : (
                  <EmptyPile w={discardW} />
                )}
              </button>
            </div>
            {/* em telas baixas a dica fica na mesma linha, para não cortar a mão */}
            <div className={`flex items-center ${compact ? 'gap-1' : 'flex-col'}`}>
              <span className="font-semibold text-white/90">
                {t.discardPile} · {view.discard.length}
              </span>
              {canTake && <span className="text-gold">{t.takeDiscard}</span>}
            </div>
          </div>
        </div>
        {/* Mortos na lateral: um cruzado sobre o outro; cada um some quando é pego */}
        <div className="flex shrink-0 flex-col items-center border-l border-white/15 pl-1 text-[11px] leading-tight text-white/90">
          <div
            className="relative flex items-center justify-center"
            style={{ width: pileH, height: pileH }}
            role="img"
            aria-label={`${t.dead}: ${deadLeft.length}`}
            data-testid="dead-piles"
          >
            {deadLeft.length === 0 && <EmptyPile w={pileW} />}
            {deadLeft.map((tm, k) => (
              <div
                key={tm}
                className="absolute drop-shadow-md"
                style={{ transform: `rotate(${[0, 90, 45][k % 3]}deg)` }}
              >
                <CardView faceDown back={deckBack(tm)} w={pileW} />
              </div>
            ))}
          </div>
          <span className="font-semibold">{t.dead}</span>
        </div>
      </div>

      {/* Seus jogos (abaixo do centro) */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2" data-testid="melds-area">
        <MeldRow
          title={t.yourMelds}
          melds={myMelds}
          mine
          selCards={selCards}
          cfg={cfg}
          onTap={tapMeld}
        />
      </div>

      {/* Meu lugar, fase e ações: acima da mão, em altura fixa para a mesa não pular */}
      <div className={`flex shrink-0 items-center gap-2 px-2 ${compact ? 'h-12' : 'h-[76px]'}`}>
        <div
          className={`relative flex w-14 shrink-0 flex-col items-center rounded-xl p-0.5 ${myTurn ? 'turn-glow bg-gold/25 ring-2 ring-gold' : 'bg-black/20'}`}
          data-testid="me-seat"
          data-seat={me}
        >
          <Avatar
            name={names[me] ?? '?'}
            pick={lobby.players.find((p) => p.id === lobby.order[me])?.avatar}
            size={compact ? 26 : 38}
            speaking={!!speaking[myId ?? '']}
          />
          <div className="max-w-full truncate text-[11px] font-semibold">{names[me]}</div>
          <Reactions list={reactionOf(lobby.order[me]!)} />
        </div>
        <div
          className={`flex min-w-0 flex-1 items-center justify-center gap-1 ${compact ? '' : 'flex-col'}`}
        >
          {view.status === 'playing' && (
            <span
              className={`flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1 text-[11px] ${myTurn ? 'text-white' : 'text-white/65'}`}
              role="status"
              data-testid="phase-pill"
            >
              {myTurn && <span className="h-1.5 w-1.5 rounded-full bg-gold" />}
              {!myTurn ? t.waitTurn : view.phase === 'draw' ? t.phase.draw : t.phasePlay}
            </span>
          )}
          <div className="flex items-center gap-1">
            {selected.length > 0 && (
              <button className="btn-ghost !min-h-[32px] !px-2 text-xs" onClick={clearSel}>
                <Icon name="undo-selection" size={16} /> {selected.length}
              </button>
            )}
            {myTurn && view.canRefuseDraw && (
              <button
                className="btn-ghost !min-h-[32px] !px-2 text-xs"
                onClick={() => act({ t: 'game', action: { type: 'REJECT_DRAW' } })}
              >
                ↩ {t.refuse}
              </button>
            )}
          </div>
        </div>
        <div className={`flex w-28 shrink-0 gap-1 ${compact ? '!w-52' : 'flex-col'}`}>
          {myTurn && view.phase === 'play' && (
            <>
              <button
                className="btn-primary !min-h-[36px] flex-1 !px-2 text-sm"
                disabled={!canMeld}
                onClick={onMeldClick}
                data-testid="meld-btn"
              >
                {t.meld}
              </button>
              <button
                className="btn-danger !min-h-[36px] flex-1 !px-2 text-sm"
                disabled={selected.length !== 1}
                onClick={() => doDiscard(selected[0]!)}
                data-testid="discard-btn"
              >
                {t.discard}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Mão em leque */}
      <div
        className="flex shrink-0 overflow-x-auto px-3 pt-4"
        style={{ touchAction: 'pan-x', paddingBottom: 'calc(8px + var(--safe-bottom))' }}
        data-testid="hand"
      >
        {hand.map((c, i) => (
          <div
            key={c.id}
            data-card-id={c.id}
            data-code={cardCode(c)}
            onPointerDown={(e) => onCardPointerDown(e, c)}
            className="relative shrink-0 cursor-grab"
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
              fresh={fresh.includes(c.id)}
            />
            {/* o selo só aparece em poucas cartas; ao pegar o lixo, o brilho basta */}
            {fresh.includes(c.id) && fresh.length <= 2 && (
              <span
                className="pointer-events-none absolute -top-4 left-0 rounded bg-sky-400 px-1 text-[9px] font-black uppercase leading-4 text-black"
                data-testid="fresh-tag"
              >
                {t.newCard}
              </span>
            )}
          </div>
        ))}
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
            {view.discard.map((c) => (
              <CardView key={c.id} card={c} w={42} />
            ))}
          </div>
          {canTake && (
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

      <TableFx view={view} handNumber={match.handNumber} names={names} />

      {panel && <Panels initial={panel} onClose={() => setPanel(null)} />}
    </div>
  );
}

type SeatSide = 'left' | 'top' | 'right';
type Reaction = { key: Key; emoji: string };

function Reactions({ list }: { list: Reaction[] }) {
  return (
    <>
      {list.map((r) => (
        <span key={r.key} className="float-up pointer-events-none absolute -top-1 text-2xl">
          {r.emoji}
        </span>
      ))}
    </>
  );
}

/** Lugar de um adversário: avatar, nome e o leque de cartas viradas com a quantidade. */
function OpponentSeat({
  index,
  side,
  small,
  name,
  avatar,
  cards,
  partner,
  isTurn,
  offline,
  speaking,
  reactions,
}: {
  index: number;
  side: SeatSide;
  small: boolean;
  name: string;
  avatar: number | undefined;
  cards: number;
  partner: boolean;
  isTurn: boolean;
  offline: boolean;
  speaking: boolean;
  reactions: Reaction[];
}) {
  const vertical = side !== 'top';
  const w = 22; // largura de cada carta do leque
  const h = Math.round(w * 1.4);
  const drawn = Math.min(cards, 11); // o número mostra o total; o desenho para em 11
  // comprimento máximo do leque: as cartas se apertam conforme a quantidade
  const step = Math.min(8, (vertical ? 56 : 80) / Math.max(1, drawn - 1));
  const length = w + step * Math.max(0, drawn - 1);
  return (
    <div
      className={`relative flex min-w-0 items-center rounded-xl p-1 ${vertical ? 'w-14 shrink-0 flex-col gap-1 self-center' : 'gap-2'} ${isTurn ? 'turn-glow bg-gold/25 ring-2 ring-gold' : 'bg-black/20'}`}
      data-testid={`opp-${index}`}
      data-seat={index}
    >
      <div className="flex w-[52px] min-w-0 flex-col items-center leading-tight">
        <Avatar name={name} pick={avatar} size={small ? 28 : 38} speaking={speaking} />
        <div className="max-w-full truncate text-[11px] font-semibold">{name}</div>
        {partner && <div className="text-[10px] text-gold">({t.partner})</div>}
      </div>
      <div
        className="relative shrink-0"
        style={vertical ? { width: h, height: length } : { width: length, height: h }}
        role="img"
        aria-label={`${cards} cartas`}
      >
        {Array.from({ length: drawn }, (_, k) => (
          <div
            key={k}
            aria-hidden
            className="absolute"
            style={
              vertical
                ? {
                    // carta deitada, virada para o centro da mesa
                    top: k * step - (h - w) / 2,
                    left: (h - w) / 2,
                    transform: `rotate(${side === 'left' ? 90 : -90}deg)`,
                  }
                : { top: 0, left: k * step }
            }
          >
            <CardView faceDown back={deckBack(k + index)} w={w} />
          </div>
        ))}
        <span className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/80 px-1.5 text-[11px] font-bold">
          {cards}
        </span>
      </div>
      {offline && <span className="text-xs">⚠</span>}
      <Reactions list={reactions} />
    </div>
  );
}

function EmptyPile({ w }: { w: number }) {
  return (
    <div
      className="rounded-md border-2 border-dashed border-white/30"
      style={{ width: w, height: Math.round(w * 1.4) }}
    />
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
                  <div
                    key={s.card.id}
                    data-meld-card={s.card.id}
                    style={{ marginLeft: i === 0 ? 0 : -18 }}
                  >
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
