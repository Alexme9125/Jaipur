import { motion, useReducedMotion } from 'motion/react';
import { useSyncExternalStore, type CSSProperties } from 'react';
import type { Card, CardType } from '@shared/engine/types';
import { GOODS_META } from '@shared/engine';
import { CardArt, Glyph } from './Glyph';
import css from './CardView.module.css';

export const cardColor = (t: CardType) => `var(--${t})`;
export const cardDeep = (t: CardType) => `var(--${t}-deep)`;
export const cardTint = (t: CardType) => `var(--${t}-tint)`;
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
    '--c': cardColor(card.type),
    '--c-deep': cardDeep(card.type),
    '--c-tint': cardTint(card.type),
  } as CSSProperties;

  const inner = (
    <motion.div
      className={css.cardInner}
      initial={flipFrom ? { rotateY: flipFrom === 'up' ? 0 : 180 } : false}
      animate={{ rotateY: rotate }}
      transition={
        reduce ? { duration: 0 } : { type: 'spring', stiffness: 360, damping: 28 }
      }
      style={style}
    >
      <div className={`${css.face} ${css.front}`}>
        <div className={css.frame} />
        <div className={`${css.corner} ${css.cornerTl}`}>
          <span className={css.cornerGlyph}>
            <Glyph type={card.type} size={13} />
          </span>
          <span className={css.cornerName}>{typeName(card.type)}</span>
        </div>
        <div className={css.center}>
          <div className={css.arch}>
            <span className={css.artWrap}>
              <CardArt type={card.type} size={62} />
            </span>
          </div>
        </div>
        <span className={css.compactName}>{typeName(card.type)}</span>
        <div className={`${css.corner} ${css.cornerBr}`}>
          <span className={css.cornerGlyph}>
            <Glyph type={card.type} size={13} />
          </span>
        </div>
        {selected && <span className={css.selPip} aria-hidden="true" />}
      </div>
      <div className={`${css.face} ${css.back}`}>
        <span className={css.backMark} aria-hidden="true" />
      </div>
    </motion.div>
  );

  const cls = [
    css.card,
    mini ? css.mini : '',
    compact ? css.compact : '',
    card.type === 'camel' ? css.isCamel : '',
    selected ? css.selected : '',
    invalid ? css.shake : '',
  ]
    .filter(Boolean)
    .join(' ');

  const body = <div style={{ position: 'absolute', inset: 0 }}>{inner}</div>;

  if (selectable && onClick) {
    return (
      <motion.button
        type="button"
        className={cls}
        onClick={onClick}
        aria-label={ariaLabel ?? typeName(card.type)}
        aria-pressed={selected}
        animate={selected ? { y: -10 } : { y: 0 }}
        whileHover={selected ? { y: -12 } : { y: -5 }}
        whileTap={{ scale: 0.97 }}
        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 28 }}
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
