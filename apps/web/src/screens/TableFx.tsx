/**
 * Animações da mesa. Observa as mudanças de estado, faz cópias das cartas voarem entre os lugares
 * (monte, lixo, mão, jogos, adversários) e mostra os avisos de canastra, morto e batida.
 * Não altera o jogo: as cópias não recebem toques e somem ao fim do voo.
 */
import type { PlayerView } from '@buraco/engine';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type FxEvent, type Snapshot, diffEvents } from '../fx';
import { t } from '../i18n';
import { badgeUrl } from '../theme';

const FLIGHT_MS = 420;
const BANNER_MS = 1800;

interface Banner {
  key: number;
  badge: string;
  text: string;
}

const find = (selector: string) => document.querySelector<HTMLElement>(selector);
const cardIn = (selector: string) => find(selector)?.firstElementChild as HTMLElement | null;
const handCard = (id: number) => cardIn(`[data-card-id="${id}"]`);
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Cópia solta de um elemento, sem os atributos que o identificam na mesa. */
function ghost(el: Element): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  for (const node of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    for (const attr of [...node.attributes]) {
      if (attr.name.startsWith('data-') || attr.name === 'role' || attr.name === 'aria-label') {
        node.removeAttribute(attr.name);
      }
    }
  }
  copy.setAttribute('aria-hidden', 'true');
  copy.classList.add('fx-ghost');
  return copy;
}

export function TableFx({
  view,
  handNumber,
  names,
}: {
  view: PlayerView;
  handNumber: number;
  names: string[];
}) {
  const prev = useRef<Snapshot | null>(null);
  // posições e cópias do quadro anterior: a carta que saiu já não está na tela
  const lastRects = useRef(new Map<number, DOMRect>());
  const lastDiscard = useRef<{ el: Element; rect: DOMRect } | null>(null);
  const ghosts = useRef(new Set<HTMLElement>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [banners, setBanners] = useState<Banner[]>([]);
  const bannerKey = useRef(0);

  /** Voa uma cópia de `el` de `from` até `to`; `hide` fica invisível até a cópia chegar. */
  function fly(el: Element, from: DOMRect, to: DOMRect, delay = 0, hide?: Element | null) {
    if (!to.width || !from.width) return;
    const copy = ghost(el);
    const size = el.isConnected ? el.getBoundingClientRect() : from;
    const w = size.width;
    const h = size.height;
    Object.assign(copy.style, {
      position: 'fixed',
      left: `${to.left + to.width / 2 - w / 2}px`,
      top: `${to.top + to.height / 2 - h / 2}px`,
      width: `${w}px`,
      height: `${h}px`,
      margin: '0',
    });
    document.body.appendChild(copy);
    ghosts.current.add(copy);
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    // destino grande (um lugar na mesa) faz a carta encolher ao chegar
    const shrink = to.width > w * 1.5 ? 0.5 : 1;
    const anim = copy.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) rotate(-8deg) scale(1)`, offset: 0 },
        { transform: `translate(${dx * 0.4}px, ${dy * 0.4 - 24}px) rotate(3deg) scale(1.15)` },
        { transform: `translate(0, 0) rotate(0) scale(${shrink})`, offset: 1 },
      ],
      { duration: FLIGHT_MS, delay, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' },
    );
    const done = () => {
      copy.remove();
      ghosts.current.delete(copy);
    };
    anim.onfinish = done;
    anim.oncancel = done;
    hide?.animate([{ opacity: 0 }, { opacity: 0 }], {
      duration: FLIGHT_MS + delay,
      fill: 'backwards',
    });
  }

  function announce(badge: string, text: string) {
    const key = ++bannerKey.current;
    setBanners((list) => [...list, { key, badge, text }]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setBanners((list) => list.filter((b) => b.key !== key));
    }, BANNER_MS);
    timers.current.add(timer);
  }

  function play(e: FxEvent) {
    if (e.type === 'canasta') {
      const badge = e.kind === 'meia_real' ? 'canastra-real' : `canastra-${e.kind}`;
      return announce(badge, `${t.canasta[e.kind]}!`);
    }
    if (e.type === 'dead') announce('pegou-o-morto', t.tookDead(names[e.player] ?? ''));
    if (e.type === 'out') return announce('bateu', t.wentOut(names[e.player] ?? ''));
    if (reducedMotion()) return;

    const stock = cardIn('[data-fx="stock"]');
    const mine = 'player' in e && e.player === view.you;
    const seat = 'player' in e ? find(`[data-seat="${e.player}"]`) : null;
    const rect = (el: Element) => el.getBoundingClientRect();

    if (e.type === 'deal') {
      if (!stock) return;
      document.querySelectorAll('[data-card-id]').forEach((slot, i) => {
        const card = slot.firstElementChild;
        if (card) fly(card, rect(stock), rect(card), i * 55, card);
      });
    } else if (e.type === 'draw') {
      const pile = lastDiscard.current;
      const source = e.from === 'discard' ? pile?.rect : stock && rect(stock);
      if (!source) return;
      if (mine) {
        e.mine.forEach((id, i) => {
          const card = handCard(id);
          // pilhas grandes: só as primeiras voam, o resto aparece
          if (card && i < 12) fly(card, source, rect(card), i * 45, card);
        });
      } else if (seat) {
        const shown = e.from === 'discard' ? pile?.el : stock;
        if (shown) fly(shown, source, rect(seat));
      }
    } else if (e.type === 'discard') {
      const card = cardIn(`[data-discard-id="${e.cardId}"]`);
      const source = mine ? lastRects.current.get(e.cardId) : seat && rect(seat);
      if (card && source) fly(card, source, rect(card), 0, card);
    } else if (e.type === 'meld') {
      e.cardIds.forEach((id, i) => {
        const card = cardIn(`[data-meld-card="${id}"]`);
        const source = mine ? lastRects.current.get(id) : seat && rect(seat);
        if (card && source) fly(card, source, rect(card), i * 60, card);
      });
    } else if (e.type === 'dead' && !mine && seat) {
      const piles = find('[data-testid="dead-piles"]');
      if (stock && piles) fly(stock, rect(piles), rect(seat), 250);
    }
  }

  useLayoutEffect(() => {
    const next = { view, handNumber };
    if (prev.current?.view !== view) {
      const events = diffEvents(prev.current, next);
      prev.current = next;
      events.forEach(play);
    }
    // guarda onde cada carta está agora, para o próximo voo
    lastRects.current = new Map();
    for (const el of document.querySelectorAll<HTMLElement>('[data-card-id]')) {
      const card = el.firstElementChild;
      if (card) lastRects.current.set(Number(el.dataset.cardId), card.getBoundingClientRect());
    }
    const top = [...document.querySelectorAll('[data-discard-id]')].pop()?.firstElementChild;
    lastDiscard.current = top ? { el: ghost(top), rect: top.getBoundingClientRect() } : null;
  });

  useEffect(() => {
    const flying = ghosts.current;
    const pending = timers.current;
    return () => {
      for (const g of flying) g.remove();
      for (const timer of pending) clearTimeout(timer);
      // o StrictMode desmonta e monta de novo: sem isto a distribuição se perderia
      prev.current = null;
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-1/3 z-[66] flex flex-col items-center gap-2"
      aria-live="polite"
    >
      {banners.map((b) => (
        <div
          key={b.key}
          className="fx-banner flex items-center gap-2 rounded-2xl border-2 border-gold bg-black/85 px-4 py-2 text-lg font-black text-gold shadow-xl"
          data-testid="fx-banner"
        >
          <img src={badgeUrl(b.badge)} alt="" width={44} height={44} />
          {b.text}
        </div>
      ))}
    </div>
  );
}
