import { motion, useReducedMotion } from 'motion/react';
import { useSyncExternalStore, type CSSProperties } from 'react';
import type { Card, CardType } from '@shared/engine/types';
import { GOODS_META } from '@shared/engine';
import { Glyph } from './Glyph';
import css from './CardView.module.css';

export const cardColor = (t: CardType) => `var(--${t})`;
export const typeName = (t: CardType) => GOODS_META[t].zh;

const narrowMq = () => window.matchMedia('(max-width: 720px)');
const subscribeNarrow = (cb: () => void) => {
  const mq = narrowMq();
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

/** true below 720px viewport — full-size cards there are < 80px and use the compact face */
export function useNarrowCards() {
  return useSyncExternalStore(
    subscribeNarrow,
    () => narrowMq().matches,
    () => false,
  );
}

export function CardView({
  card,
  faceDown = false,
  flipFrom,
  mini = false,
  selected = false,
  selectable = true,
  invalid = false,
  onClick,
  ariaLabel,
}: {
  card: Card;
  faceDown?: boolean;
  /** id crossed a remount with a different face: 'up' = was face-up (flip 0→180), 'down' = was hidden (180→0) */
  flipFrom?: 'up' | 'down';
  mini?: boolean;
  selected?: boolean;
  selectable?: boolean;
  invalid?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const reduce = useReducedMotion();
  const narrow = useNarrowCards();
  const compact = mini || narrow;
  const rotate = faceDown ? 180 : 0;
  const style = {
    '--c': card.type === 'camel' ? 'var(--camel-ink)' : cardColor(card.type),
  } as CSSProperties;
  const inner = (
    <motion.div
      className={css.cardInner}
      initial={flipFrom ? { rotateY: flipFrom === 'up' ? 0 : 180 } : false}
      animate={{ rotateY: rotate }}
      transition={
        reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30 }
      }
      style={style}
    >
      <div className={`${css.face} ${css.front}`}>
        <div className={css.frame} />
        <div className={`${css.corner} ${css.cornerTl}`}>
          <span className={css.cornerGlyph}>
            <Glyph type={card.type} size={14} />
          </span>
          <span className={css.cornerName}>{typeName(card.type)}</span>
        </div>
        <div className={css.center}>
          <div className={css.circle}>
            <span className={css.centerGlyph}>
              <Glyph type={card.type} size={26} />
            </span>
          </div>
        </div>
        <span className={css.compactName}>{typeName(card.type)}</span>
        <div className={`${css.corner} ${css.cornerBr}`}>
          <span className={css.cornerGlyph}>
            <Glyph type={card.type} size={14} />
          </span>
        </div>
      </div>
      <div className={`${css.face} ${css.back}`} />
    </motion.div>
  );
  const cls = [
    css.card,
    mini ? css.mini : '',
    compact ? css.compact : '',
    selected ? css.glow : '',
    invalid ? css.shake : '',
  ]
    .filter(Boolean)
    .join(' ');
  const body = (
    // plain absolute fill — travel is handled by the TravelCard layoutId
    // wrapper; a second motion layout here can pin transforms mid-flight
    <div style={{ position: 'absolute', inset: 0 }}>{inner}</div>
  );
  if (selectable && onClick) {
    return (
      <motion.button
        type="button"
        className={cls}
        onClick={onClick}
        aria-label={ariaLabel ?? typeName(card.type)}
        whileHover={{ y: -6 }}
        whileTap={{ scale: 0.97 }}
        style={{ padding: 0 }}
      >
        {body}
      </motion.button>
    );
  }
  return (
    <div
      className={cls}
      role="img"
      aria-label={ariaLabel ?? (faceDown ? '牌背' : typeName(card.type))}
    >
      {body}
    </div>
  );
}
