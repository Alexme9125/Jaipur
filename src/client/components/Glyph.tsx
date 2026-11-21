import type { CardType } from '@shared/engine/types';

/**
 * Compact goods glyphs for token rails, corner indices, and stat readouts.
 * 48×48 viewBox, crisp balanced stroke & soft fill.
 */
export function Glyph({ type, size = 48 }: { type: CardType; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {smallGlyphs[type]}
    </svg>
  );
}

/**
 * Bespoke collector-grade editorial card centerpiece art.
 * Multi-tonal geometric printmaking vector style using currentColor shades
 * + cardstock negative space — zero gradients or noisy details.
 */
export function CardArt({ type, size = 64 }: { type: CardType; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      aria-hidden="true"
    >
      {cardIllustrations[type]}
    </svg>
  );
}

const F = 'currentColor';

const smallGlyphs: Record<CardType, React.ReactNode> = {
  diamond: (
    <>
      <polygon points="12,15 36,15 43,23 24,42 5,23" fill={F} fillOpacity="0.18" />
      <path d="M5 23H43" />
      <path d="M17 15L13 23L24 42L35 23L31 15" />
    </>
  ),
  gold: (
    <>
      <polygon points="5,37 22,37 19,29 8,29" fill={F} fillOpacity="0.22" />
      <polygon points="26,37 43,37 40,29 29,29" fill={F} fillOpacity="0.22" />
      <polygon points="15,26 33,26 30,18 18,18" fill={F} fillOpacity="0.22" />
      <path d="M5 37H22L19 29H8Z" />
      <path d="M26 37H43L40 29H29Z" />
      <path d="M15 26H33L30 18H18Z" />
    </>
  ),
  silver: (
    <>
      <circle cx="24" cy="24" r="16" fill={F} fillOpacity="0.18" />
      <circle cx="24" cy="24" r="10.5" strokeDasharray="3 3" />
      <polygon points="24,18 30,24 24,30 18,24" fill={F} />
    </>
  ),
  cloth: (
    <>
      <path d="M13 13H37V33H13Z" fill={F} fillOpacity="0.18" />
      <path d="M37 33L42 41H29L29 33" fill={F} fillOpacity="0.24" />
      <ellipse cx="13" cy="23" rx="5.5" ry="10" fill={F} fillOpacity="0.25" />
      <ellipse cx="13" cy="23" rx="5.5" ry="10" />
      <path d="M13 13H37V33H13" />
      <path d="M37 33L41 41H29V33" />
      <path d="M24 13V33" strokeOpacity="0.55" />
    </>
  ),
  spice: (
    <>
      <path d="M9 35C9 25 15 19 24 19C33 19 39 25 39 35Z" fill={F} fillOpacity="0.22" />
      <path d="M7 35H41" />
      <circle cx="18" cy="12" r="2" fill={F} stroke="none" />
      <circle cx="24" cy="8" r="2.2" fill={F} stroke="none" />
      <circle cx="30" cy="12" r="2" fill={F} stroke="none" />
    </>
  ),
  leather: (
    <>
      <path
        d="M14 11C20 15 28 15 34 11C40 15 40 21 36 24C40 27 40 33 34 37C28 33 20 33 14 37C8 33 8 27 12 24C8 21 8 15 14 11Z"
        fill={F}
        fillOpacity="0.2"
      />
      <path d="M19 24H29" strokeDasharray="2 3" />
    </>
  ),
  camel: (
    <>
      <path
        d="M9 28C13 20 17 14 22 14C26 14 28 21 32 25C34 21 37 17 41 16L44 18"
        fill="none"
      />
      <path d="M9 28H32M12 28V39M17 28V39M26 28V39M31 28V39M9 28L6 32" />
    </>
  ),
};

const cardIllustrations: Record<CardType, React.ReactNode> = {
  diamond: (
    <g>
      {/* outer faceted ruby-diamond silhouette */}
      <polygon points="22,22 58,22 68,35 40,66 12,35" fill={F} fillOpacity="0.16" />
      {/* crown planes */}
      <polygon points="22,22 40,22 30,35 12,35" fill={F} fillOpacity="0.28" />
      <polygon points="40,22 58,22 68,35 50,35" fill={F} fillOpacity="0.48" />
      <polygon points="30,35 40,22 50,35" fill={F} fillOpacity="0.12" />
      {/* pavilion planes */}
      <polygon points="12,35 30,35 40,66" fill={F} fillOpacity="0.42" />
      <polygon points="30,35 50,35 40,66" fill={F} fillOpacity="0.72" />
      <polygon points="50,35 68,35 40,66" fill={F} fillOpacity="0.92" />
      {/* crisp structural facet lines */}
      <polygon
        points="22,22 58,22 68,35 40,66 12,35"
        stroke={F}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M12 35H68M30 35L40 22L50 35M30 35L40 66L50 35"
        stroke="var(--card-stock, #FCFBF8)"
        strokeOpacity="0.65"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* subtle geometric top star glint */}
      <path
        d="M40 9L41.8 13.2L46 15L41.8 16.8L40 21L38.2 16.8L34 15L38.2 13.2Z"
        fill={F}
        fillOpacity="0.65"
      />
    </g>
  ),
  gold: (
    <g>
      {/* top bar */}
      <polygon points="27,23 53,23 58,36 22,36" fill={F} fillOpacity="0.88" />
      <polygon points="29,23 51,23 48,28 32,28" fill="var(--card-stock, #FCFBF8)" fillOpacity="0.48" />
      <polygon points="27,23 53,23 58,36 22,36" stroke={F} strokeWidth="2" strokeLinejoin="round" />

      {/* bottom left bar */}
      <polygon points="12,41 37,41 41,56 8,56" fill={F} fillOpacity="0.78" />
      <polygon points="14,41 35,41 32,46.5 17,46.5" fill="var(--card-stock, #FCFBF8)" fillOpacity="0.44" />
      <polygon points="12,41 37,41 41,56 8,56" stroke={F} strokeWidth="2" strokeLinejoin="round" />

      {/* bottom right bar */}
      <polygon points="43,41 68,41 72,56 39,56" fill={F} fillOpacity="0.96" />
      <polygon points="45,41 66,41 63,46.5 48,46.5" fill="var(--card-stock, #FCFBF8)" fillOpacity="0.34" />
      <polygon points="43,41 68,41 72,56 39,56" stroke={F} strokeWidth="2" strokeLinejoin="round" />

      {/* engraved stamp lines */}
      <path
        d="M34 32H46M19 51H30M50 51H61"
        stroke="var(--card-stock, #FCFBF8)"
        strokeOpacity="0.55"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* base shadow rule */}
      <line x1="12" y1="62" x2="68" y2="62" stroke={F} strokeOpacity="0.25" strokeWidth="2" strokeLinecap="round" />
    </g>
  ),
  silver: (
    <g>
      {/* outer minted royal coin */}
      <circle cx="40" cy="40" r="25" fill={F} fillOpacity="0.18" stroke={F} strokeWidth="2.4" />
      <circle cx="40" cy="40" r="20.5" fill={F} fillOpacity="0.2" />
      <circle
        cx="40"
        cy="40"
        r="19.5"
        stroke={F}
        strokeWidth="1.4"
        strokeDasharray="2.5 3.2"
        strokeOpacity="0.75"
      />
      {/* central octagonal Jaipur mohur stamp */}
      <polygon
        points="40,24 51,29 56,40 51,51 40,56 29,51 24,40 29,29"
        fill={F}
        fillOpacity="0.86"
      />
      {/* negative-space inner star */}
      <path
        d="M40 29L43.5 36.5L51 40L43.5 43.5L40 51L36.5 43.5L29 40L36.5 36.5Z"
        fill="var(--card-stock, #FCFBF8)"
        fillOpacity="0.92"
      />
      <circle cx="40" cy="40" r="2.6" fill={F} />
    </g>
  ),
  cloth: (
    <g>
      {/* unfurled silk drape tail */}
      <path d="M48 49H64L68 65H45L48 49Z" fill={F} fillOpacity="0.42" />
      <path
        d="M48 49H64L68 65H45L48 49Z"
        stroke={F}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M50 58H64M51 62H65"
        stroke="var(--card-stock, #FCFBF8)"
        strokeOpacity="0.65"
        strokeWidth="1.5"
      />
      {/* main rolled silk bolt */}
      <path d="M22 22H60C64 22 66 28 66 36C66 44 64 50 60 50H22V22Z" fill={F} fillOpacity="0.82" />
      {/* geometric block-print textile bands */}
      <path d="M35 22H42V50H35Z" fill="var(--card-stock, #FCFBF8)" fillOpacity="0.28" />
      <path d="M47 22H52V50H47Z" fill="var(--card-stock, #FCFBF8)" fillOpacity="0.45" />
      <path
        d="M38.5 27L41 31L38.5 35L36 31ZM38.5 37L41 41L38.5 45L36 41Z"
        fill="var(--card-stock, #FCFBF8)"
        fillOpacity="0.7"
      />
      {/* left spiraled roll end */}
      <ellipse cx="22" cy="36" rx="8.5" ry="14" fill="var(--card-stock, #FCFBF8)" stroke={F} strokeWidth="2.2" />
      <ellipse cx="22" cy="36" rx="5" ry="9" fill={F} fillOpacity="0.25" stroke={F} strokeWidth="1.5" />
      <ellipse cx="22" cy="36" rx="2" ry="3.8" fill={F} />
      {/* outline top & bottom of bolt */}
      <path
        d="M22 22H60C64 22 66 28 66 36C66 44 64 50 60 50H22"
        stroke={F}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </g>
  ),
  spice: (
    <g>
      {/* aromatic spice mound */}
      <path d="M17 45C17 31 27 23 40 23C53 23 63 31 63 45Z" fill={F} fillOpacity="0.58" />
      <path d="M25 45C25 34 32 27 40 27C48 27 55 34 55 45Z" fill={F} fillOpacity="0.82" />
      {/* fine spice highlight contour */}
      <path
        d="M28 36C31 31 35 29 40 29"
        stroke="var(--card-stock, #FCFBF8)"
        strokeOpacity="0.65"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* brass/ceramic footed spice vessel */}
      <path
        d="M14 45H66L61 57C59 61 54 63 48 63H32C26 63 21 61 19 57L14 45Z"
        fill={F}
        fillOpacity="0.94"
      />
      <rect x="29" y="63" width="22" height="4" rx="2" fill={F} fillOpacity="0.6" />
      <path
        d="M20 50H60"
        stroke="var(--card-stock, #FCFBF8)"
        strokeOpacity="0.5"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* floating botanical spice stars / saffron buds */}
      <circle cx="29" cy="17" r="2.4" fill={F} fillOpacity="0.6" />
      <path d="M40 10L41.6 13.8L45.4 15.4L41.6 17L40 20.8L38.4 17L34.6 15.4L38.4 13.8Z" fill={F} />
      <circle cx="51" cy="17" r="2.4" fill={F} fillOpacity="0.6" />
    </g>
  ),
  leather: (
    <g>
      {/* sculpted desert tanned hide */}
      <path
        d="M23 16C32 22 48 22 57 16C66 22 67 31 60 39C67 47 66 56 57 62C48 56 32 56 23 62C14 56 13 47 20 39C13 31 14 22 23 16Z"
        fill={F}
        fillOpacity="0.86"
        stroke={F}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      {/* lighter inner hide grain */}
      <path
        d="M27 22C34 26 46 26 53 22C59 26 60 32 54 39C60 46 59 52 53 56C46 52 34 52 27 56C21 52 20 46 26 39C20 32 21 26 27 22Z"
        fill="var(--card-stock, #FCFBF8)"
        fillOpacity="0.16"
        stroke="var(--card-stock, #FCFBF8)"
        strokeOpacity="0.65"
        strokeWidth="1.5"
        strokeDasharray="3.2 3.2"
      />
      {/* central saddlecraft medallion */}
      <polygon
        points="40,31 47,39 40,47 33,39"
        fill="var(--card-stock, #FCFBF8)"
        fillOpacity="0.85"
      />
      <circle cx="40" cy="39" r="2.5" fill={F} />
    </g>
  ),
  camel: (
    <g>
      {/* warm desert horizon rule */}
      <line x1="12" y1="64" x2="68" y2="64" stroke={F} strokeOpacity="0.3" strokeWidth="2" strokeLinecap="round" />
      {/* sculptural dromedary silhouette */}
      <path
        d="M17 44C17 34 23 23 32 22C39 21 43 29 48 35C52 30 55 24 60 22C63 21 67 22 68 25C68 27 65 28 62 28C59 31 57 38 54 44C51 47 46 48 41 48H25C20 48 17 47 17 44Z"
        fill={F}
        fillOpacity="0.88"
      />
      {/* tail */}
      <path d="M18 42L13 50" stroke={F} strokeWidth="2.4" strokeLinecap="round" />
      {/* four poised legs */}
      <path
        d="M22 46V63M28 47L27 63M46 47L45 63M52 45L54 63"
        stroke={F}
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* decorative Jaipur woven saddle blanket on hump */}
      <path
        d="M25 32C27 26 31 24 34 25C37 26 40 31 42 36L40 43H24L25 32Z"
        fill="var(--card-stock, #FCFBF8)"
        fillOpacity="0.82"
      />
      <polygon points="33,29 37,35 33,40 29,35" fill={F} fillOpacity="0.85" />
    </g>
  ),
};
