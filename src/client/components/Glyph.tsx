import type { CardType } from '@shared/engine/types';

/**
 * Custom goods glyphs. 48×48 viewBox, stroke 2.2, round caps/joins,
 * stroke currentColor, fill = goods color at 14%.
 */
export function Glyph({ type, size = 48 }: { type: CardType; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyphs[type]}
    </svg>
  );
}

const F = 'currentColor';

const glyphs: Record<CardType, React.ReactNode> = {
  diamond: (
    <>
      <polygon points="12,16 36,16 42,22 6,22" fill={F} fillOpacity="0.14" />
      <polygon points="6,22 42,22 24,42" fill={F} fillOpacity="0.14" />
      <path d="M16 16 L12 22 L24 42" />
      <path d="M32 16 L36 22 L24 42" />
      <path d="M24 16 L18 22" />
      <path d="M24 16 L30 22" />
    </>
  ),
  gold: (
    <>
      {/* pyramid of 3 trapezoid bars */}
      <polygon points="4,38 22,38 19,30 7,30" fill={F} fillOpacity="0.14" />
      <polygon points="26,38 44,38 41,30 29,30" fill={F} fillOpacity="0.14" />
      <polygon points="15,28 33,28 30,20 18,20" fill={F} fillOpacity="0.14" />
      <path d="M4 38 L22 38 L19 30 L7 30 Z" />
      <path d="M26 38 L44 38 L41 30 L29 30 Z" />
      <path d="M15 28 L33 28 L30 20 L18 20 Z" />
      <path d="M9 32 L17 32" />
      <path d="M31 32 L39 32" />
      <path d="M20 22 L28 22" />
    </>
  ),
  silver: (
    <>
      <circle cx="24" cy="24" r="16" fill={F} fillOpacity="0.14" />
      <circle cx="24" cy="24" r="10" />
      <rect x="21" y="21" width="6" height="6" />
    </>
  ),
  cloth: (
    <>
      {/* fabric roll from the side: rolled end ellipse + bolt + hanging tail */}
      <ellipse cx="12" cy="24" rx="5" ry="10" fill={F} fillOpacity="0.14" />
      <path d="M12 14 L38 14 L38 34 L12 34" fill={F} fillOpacity="0.14" />
      <path d="M38 34 L42 42 L30 42 L30 34" fill={F} fillOpacity="0.14" />
      <ellipse cx="12" cy="24" rx="5" ry="10" />
      <circle cx="12" cy="24" r="1.4" fill={F} />
      <path d="M12 14 L38 14" />
      <path d="M12 34 L38 34" />
      <path d="M38 14 L38 34" />
      <path d="M38 34 L42 42 L30 42 L30 34" />
    </>
  ),
  spice: (
    <>
      <path d="M8 36 C8 26 14 18 24 18 C34 18 40 26 40 36 Z" fill={F} fillOpacity="0.14" />
      <circle cx="18" cy="10" r="1.6" fill={F} />
      <circle cx="24" cy="7" r="1.6" fill={F} />
      <circle cx="30" cy="11" r="1.6" fill={F} />
    </>
  ),
  leather: (
    <>
      <path
        d="M14 12 C20 16 28 16 34 12 C40 16 40 22 36 24 C40 26 40 32 34 36 C28 32 20 32 14 36 C8 32 8 26 12 24 C8 22 8 16 14 12 Z"
        fill={F}
        fillOpacity="0.14"
      />
      <path
        d="M17 16 C21 19 27 19 31 16 C35 19 35 22 32 24 C35 26 35 29 31 32 C27 29 21 29 17 32 C13 29 13 26 16 24 C13 22 13 19 17 16 Z"
        strokeDasharray="2.5 3"
      />
    </>
  ),
  camel: (
    <>
      {/* dromedary line drawing */}
      <path d="M10 28 C14 20 18 14 22 14 C26 14 28 20 32 26" />
      <path d="M32 26 C34 22 36 18 40 16 L44 18" />
      <path d="M10 28 L32 28" />
      <path d="M12 28 L12 40" />
      <path d="M17 28 L17 40" />
      <path d="M27 28 L27 40" />
      <path d="M31 28 L31 40" />
      <path d="M10 28 L7 32" />
    </>
  ),
};
