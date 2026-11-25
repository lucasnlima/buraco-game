/** O que mudou de um estado para o outro: base para marcar cartas novas e animar as jogadas. */
import { type PlayerView, canastaType } from '@buraco/engine';

export interface Snapshot {
  view: PlayerView;
  handNumber: number;
}

export type FxEvent =
  | { type: 'deal' }
  | { type: 'draw'; player: number; from: 'stock' | 'discard'; mine: number[] }
  | { type: 'discard'; player: number; cardId: number }
  | { type: 'meld'; player: number; cardIds: number[] }
  | { type: 'canasta'; kind: NonNullable<ReturnType<typeof canastaType>> }
  | { type: 'dead'; player: number }
  | { type: 'out'; player: number };

const addedToHand = (prev: PlayerView, next: PlayerView): number[] => {
  const before = new Set(prev.myHand.map((c) => c.id));
  return next.myHand.filter((c) => !before.has(c.id)).map((c) => c.id);
};

/**
 * Cartas que acabaram de chegar à minha mão. Ficam marcadas até o fim da minha vez; as do morto
 * pego ao descartar ficam até a minha próxima compra.
 */
export function nextFresh(fresh: number[], prev: Snapshot | null, next: Snapshot): number[] {
  if (!prev || prev.handNumber !== next.handNumber) return [];
  const a = prev.view;
  const b = next.view;
  const held = new Set(b.myHand.map((c) => c.id));
  const kept = fresh.filter((id) => held.has(id));
  const added = addedToHand(a, b);
  if (added.length) {
    // morto pego no meio da vez soma às cartas da compra
    const midTurn = a.turn === a.you && b.turn === b.you && a.phase === 'play';
    return midTurn ? [...kept, ...added] : added;
  }
  const myTurnEnded = a.turn === a.you && b.turn !== b.you;
  return myTurnEnded ? [] : kept;
}

export function diffEvents(prev: Snapshot | null, next: Snapshot): FxEvent[] {
  const b = next.view;
  if (!prev || prev.handNumber !== next.handNumber) {
    // ao recarregar a página no meio da mão não há distribuição para mostrar
    return b.version === 0 ? [{ type: 'deal' }] : [];
  }
  const a = prev.view;
  if (b.version <= a.version) return [];
  const player = a.turn;
  const events: FxEvent[] = [];

  if (a.phase === 'draw' && b.phase === 'play' && b.turn === player) {
    const from = b.discard.length < a.discard.length ? 'discard' : 'stock';
    events.push({ type: 'draw', player, from, mine: addedToHand(a, b) });
  }

  const melded = new Set(a.melds.flatMap((m) => m.slots.map((s) => s.card.id)));
  const cardIds = b.melds
    .flatMap((m) => m.slots.map((s) => s.card.id))
    .filter((id) => !melded.has(id));
  if (cardIds.length) events.push({ type: 'meld', player, cardIds });

  for (const m of b.melds) {
    const kind = canastaType(m);
    const old = a.melds.find((x) => x.id === m.id);
    if (kind && (!old || canastaType(old) !== kind)) events.push({ type: 'canasta', kind });
  }

  if (b.discard.length > a.discard.length) {
    events.push({ type: 'discard', player, cardId: b.discard[b.discard.length - 1]!.id });
  }
  if (b.deadTaken.some((taken, i) => taken && !a.deadTaken[i])) {
    events.push({ type: 'dead', player });
  }
  const out = b.result?.reason === 'out' ? b.result.outPlayer : null;
  if (b.status === 'ended' && a.status !== 'ended' && out !== null) {
    events.push({ type: 'out', player: out });
  }
  return events;
}
