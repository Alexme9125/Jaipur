import { motion } from 'motion/react';
import { formatTokens, rupeesToTokens } from '@shared/format';
import type { BonusTier, Token } from '@shared/engine/types';
import { cardColor } from './CardView';
import { Glyph } from './Glyph';
import css from './Pieces.module.css';

export function TokenChip({ token, plain }: { token: Token; plain?: boolean }) {
  return (
    <motion.div
      layoutId={`tok-${token.id}`}
      className={css.token}
      style={{ background: `color-mix(in srgb, ${cardColor(token.good)} 88%, #ffffff)` }}
      aria-label={`${token.good} ${token.value}`}
    >
      <span style={{ position: 'relative' }}>
        {plain ? token.value : formatTokens(rupeesToTokens(token.value))}
      </span>
    </motion.div>
  );
}

export function BonusChip({
  bonus,
  revealed,
}: {
  bonus: { id: string; tier: BonusTier; value: number | null };
  revealed?: boolean;
}) {
  const show = revealed ?? bonus.value !== null;
  return (
    <motion.div
      layoutId={`tok-${bonus.id}`}
      className={css.bonus}
      animate={{ rotateY: show ? 0 : 180 }}
      initial={false}
      transition={{ duration: 0.38, ease: [0.2, 0.7, 0.2, 1] }}
      style={{ transformStyle: 'preserve-3d' }}
    >
      {show ? (
        <span>+{formatTokens(rupeesToTokens(bonus.value ?? 0))}</span>
      ) : (
        <span className={css.bonusDown} style={{ transform: 'rotateY(180deg)' }}>
          ×{bonus.tier}
          <small>?</small>
        </span>
      )}
    </motion.div>
  );
}

export function BonusPileChip({ tier }: { tier: BonusTier }) {
  return (
    <div className={css.bonus} aria-label={`${tier} 张奖励`}>
      <span className={css.bonusDown}>
        ×{tier}
        <small>?</small>
      </span>
    </div>
  );
}

export function CamelToken() {
  return (
    <span className={css.camelToken}>
      <Glyph type="camel" size={16} />
      5K
    </span>
  );
}

export function Seal({ earned, animate = true }: { earned: boolean; animate?: boolean }) {
  if (!earned) return <span className={css.sealGhost} />;
  if (!animate) return <span className={css.seal}>印</span>;
  return (
    <motion.span
      className={css.seal}
      initial={{ scale: 1.3, rotate: -12, opacity: 0 }}
      animate={{ scale: 1, rotate: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
    >
      印
    </motion.span>
  );
}
