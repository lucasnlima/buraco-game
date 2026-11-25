import type { Card as CardT } from '@buraco/engine';
import { SUIT_COLOR_2, SUIT_COLOR_4, SUIT_GLYPH, backImageUrl, cardImageUrl } from './theme';
import { rankLabel } from '@buraco/engine';
import { useState, type ReactNode } from 'react';
import { useStore } from './store';

export function CardView({
  card,
  w = 52,
  selected = false,
  faceDown = false,
  dim = false,
  badge,
}: {
  card?: CardT;
  w?: number;
  selected?: boolean;
  faceDown?: boolean;
  dim?: boolean;
  badge?: string;
}) {
  const four = useStore((s) => s.settings.fourColors);
  const [imgFailed, setImgFailed] = useState(false);
  const h = Math.round(w * 1.4);
  const style = { width: w, height: h };
  const cls = `card-anim relative shrink-0 select-none ${selected ? '-translate-y-3 drop-shadow-[0_0_6px_#f5c542]' : ''} ${dim ? 'opacity-60' : ''}`;

  const url = faceDown ? backImageUrl() : card ? cardImageUrl(card) : null;
  if (url && !imgFailed) {
    return (
      <div className={cls} style={style}>
        <img
          src={url}
          alt=""
          draggable={false}
          className="h-full w-full rounded-md"
          onError={() => setImgFailed(true)}
        />
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
            fill="#1d4ed8"
            stroke="#fff"
            strokeWidth="3"
          />
          <rect
            x="12"
            y="12"
            width="76"
            height="116"
            rx="6"
            fill="none"
            stroke="#93c5fd"
            strokeWidth="2"
          />
          <path d="M20 20 L80 120 M80 20 L20 120" stroke="#93c5fd" strokeWidth="2" opacity=".6" />
        </svg>
      </div>
    );
  }

  const joker = card.rank === 0;
  const color = joker ? '#7b1fa2' : (four ? SUIT_COLOR_4 : SUIT_COLOR_2)[card.suit!];
  const glyph = joker ? '★' : SUIT_GLYPH[card.suit!];
  const label = rankLabel(card.rank);
  return (
    <div
      className={cls}
      style={style}
      role="img"
      aria-label={joker ? 'coringa' : `${label} de ${card.suit}`}
    >
      <svg viewBox="0 0 100 140" width={w} height={h}>
        <rect
          x="2"
          y="2"
          width="96"
          height="136"
          rx="10"
          fill="#fff"
          stroke={selected ? '#f5c542' : '#9aa5a0'}
          strokeWidth={selected ? 4 : 2}
        />
        <text
          x="9"
          y="30"
          fontSize={joker ? 17 : 28}
          fontWeight="700"
          fill={color}
          fontFamily="system-ui,sans-serif"
        >
          {joker ? 'JK' : label}
        </text>
        <text x="9" y="56" fontSize="24" fill={color}>
          {glyph}
        </text>
        <text x="50" y="98" fontSize="54" textAnchor="middle" fill={color}>
          {glyph}
        </text>
        <g transform="rotate(180 50 70)">
          <text
            x="9"
            y="30"
            fontSize={joker ? 17 : 28}
            fontWeight="700"
            fill={color}
            fontFamily="system-ui,sans-serif"
          >
            {joker ? 'JK' : label}
          </text>
          <text x="9" y="56" fontSize="24" fill={color}>
            {glyph}
          </text>
        </g>
      </svg>
      {badge && <Badge text={badge} />}
    </div>
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
  size = 44,
  speaking = false,
}: {
  name: string;
  size?: number;
  speaking?: boolean;
}) {
  const hue = [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${speaking ? 'speaking-ring' : ''}`}
      style={{
        width: size,
        height: size,
        background: `hsl(${hue} 55% 38%)`,
        fontSize: size * 0.42,
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
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
