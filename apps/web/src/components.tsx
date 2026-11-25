import type { Card as CardT } from '@buraco/engine';
import {
  SUIT_COLOR_2,
  SUIT_COLOR_4,
  avatarUrl,
  backImageUrl,
  cardImageUrl,
  iconUrl,
  suitUrl,
  type BackName,
} from './theme';
import { rankLabel } from '@buraco/engine';
import { useState, type ReactNode } from 'react';
import { useStore } from './store';

export function CardView({
  card,
  w = 52,
  selected = false,
  faceDown = false,
  back,
  dim = false,
  fresh = false,
  badge,
}: {
  card?: CardT;
  w?: number;
  selected?: boolean;
  faceDown?: boolean;
  back?: BackName;
  dim?: boolean;
  /** acabou de chegar à mão: brilho azul */
  fresh?: boolean;
  badge?: string;
}) {
  const four = useStore((s) => s.settings.fourColors);
  const [imgFailed, setImgFailed] = useState(false);
  const h = Math.round(w * 1.4);
  const style = { width: w, height: h };
  const cls = `card-anim relative shrink-0 select-none ${selected ? '-translate-y-3 drop-shadow-[0_0_6px_#f5c542]' : ''} ${dim ? 'opacity-60' : ''} ${fresh ? `fresh-card ${selected ? '' : '-translate-y-2'}` : ''}`;
  const ring = selected ? 'ring-2 ring-gold' : '';

  const url = faceDown ? backImageUrl(back) : card ? cardImageUrl(card) : null;
  if (url && !imgFailed) {
    return (
      <div
        className={cls}
        style={style}
        role="img"
        aria-label={faceDown || !card ? 'carta virada' : cardLabel(card)}
      >
        <img
          src={url}
          alt=""
          draggable={false}
          className={`h-full w-full rounded-[7%] ${ring}`}
          onError={() => setImgFailed(true)}
        />
        {card && card.rank !== 0 && <Index card={card} four={four} overlay />}
        {badge && <Badge text={badge} />}
      </div>
    );
  }

  if (faceDown || !card) {
    return (
      <div className={cls} style={style} aria-label="carta virada">
        <svg viewBox="0 0 100 140" width={w} height={h}>
          <rect
            x="2"
            y="2"
            width="96"
            height="136"
            rx="10"
            fill="#0f4d37"
            stroke="#fbf3dd"
            strokeWidth="3"
          />
          <rect
            x="11"
            y="11"
            width="78"
            height="118"
            rx="6"
            fill="none"
            stroke="#c9a227"
            strokeWidth="2"
          />
          <path d="M20 20 L80 120 M80 20 L20 120" stroke="#c9a227" strokeWidth="1.5" opacity=".6" />
        </svg>
      </div>
    );
  }

  const joker = card.rank === 0;
  const color = joker ? '#7b1fa2' : (four ? SUIT_COLOR_4 : SUIT_COLOR_2)[card.suit!];
  return (
    <div className={cls} style={style} role="img" aria-label={cardLabel(card)}>
      <svg viewBox="0 0 100 140" width={w} height={h}>
        <rect
          x="2"
          y="2"
          width="96"
          height="136"
          rx="10"
          fill="#fbf3dd"
          stroke={selected ? '#f5c542' : '#1f6b46'}
          strokeWidth={selected ? 4 : 2.5}
        />
        <rect
          x="8"
          y="8"
          width="84"
          height="124"
          rx="6"
          fill="none"
          stroke="#c9a227"
          strokeWidth="1.2"
        />
        {joker ? (
          <text x="50" y="86" fontSize="54" textAnchor="middle" fill={color}>
            ★
          </text>
        ) : (
          <image href={suitUrl(card.suit!, four)} x="22" y="42" width="56" height="56" />
        )}
      </svg>
      <Index card={card} four={four} />
      {badge && <Badge text={badge} />}
    </div>
  );
}

function cardLabel(c: CardT): string {
  return c.rank === 0
    ? 'coringa'
    : `${rankLabel(c.rank)} de ${{ S: 'espadas', H: 'copas', D: 'ouros', C: 'paus' }[c.suit!]}`;
}

/** Índice (valor + naipe) no canto superior esquerdo — essencial com as cartas sobrepostas na mão. */
function Index({ card, four, overlay = false }: { card: CardT; four: boolean; overlay?: boolean }) {
  const joker = card.rank === 0;
  const color = joker ? '#7b1fa2' : (four ? SUIT_COLOR_4 : SUIT_COLOR_2)[card.suit!];
  const label = joker ? 'JK' : rankLabel(card.rank);
  return (
    <svg
      viewBox="0 0 100 140"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      {overlay && (
        <rect
          x="3"
          y="3"
          width="34"
          height="56"
          rx="7"
          fill="#fbf3dd"
          fillOpacity=".93"
          stroke="#1f6b46"
          strokeWidth="1.5"
        />
      )}
      <text
        x="20"
        y={joker ? 32 : 30}
        textAnchor="middle"
        fontSize={label.length > 1 ? 24 : 30}
        fontWeight="800"
        fill={color}
        fontFamily="system-ui,sans-serif"
      >
        {label}
      </text>
      {!joker && (
        <image
          href={suitUrl(card.suit!, four)}
          x="7"
          y="34"
          width="26"
          height="22"
          preserveAspectRatio="xMidYMid meet"
        />
      )}
    </svg>
  );
}

function Badge({ text }: { text: string }) {
  return (
    <span className="absolute -right-1 -top-1 rounded-full bg-purple-600 px-1 text-[10px] font-bold leading-4 text-white">
      {text}
    </span>
  );
}

export function Modal({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose?: () => void;
  title?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-felt-800 p-4 shadow-xl sm:rounded-2xl"
        style={{ paddingBottom: 'calc(1rem + var(--safe-bottom))' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        {title && (
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">{title}</h2>
            {onClose && (
              <button
                className="btn-ghost !min-h-[44px] !min-w-[44px]"
                onClick={onClose}
                aria-label="Fechar"
              >
                ✕
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function Avatar({
  name,
  pick,
  size = 44,
  speaking = false,
}: {
  name: string;
  /** avatar escolhido (1..AVATAR_COUNT); vazio = automático pelo nome */
  pick?: number | null;
  size?: number;
  speaking?: boolean;
}) {
  return (
    <img
      src={avatarUrl(name, pick)}
      alt=""
      draggable={false}
      width={size}
      height={size}
      className={`shrink-0 rounded-full border-2 border-white/70 bg-felt-700 object-cover ${speaking ? 'speaking-ring' : ''}`}
      style={{ width: size, height: size }}
    />
  );
}

export function Icon({
  name,
  size = 22,
  className = '',
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={iconUrl(name)}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`inline-block shrink-0 ${className}`}
    />
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed left-1/2 z-[60] w-[92%] max-w-md -translate-x-1/2 rounded-xl bg-black/85 px-4 py-3 text-center text-sm shadow-lg"
      style={{ top: 'calc(var(--safe-top) + 12px)' }}
    >
      {toast}
    </div>
  );
}
