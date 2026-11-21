import { motion } from 'motion/react';
import type { CSSProperties } from 'react';
import { formatTokens, rupeesToTokens } from '@shared/format';
import type { BonusTier, Token } from '@shared/engine/types';
import { cardColor, cardDeep } from './CardView';
import { Glyph } from './Glyph';
import css from './Pieces.module.css';

export function TokenChip({
  token,
  plain,
  preview = false,
}: {
  token: Token;
  plain?: boolean;
  /** gently highlights top tokens about to be claimed by the current sell selection */
  preview?: boolean;
}) {
  return (
    <motion.div
      layoutId={`tok-${token.id}`}
      className={`${css.token} ${preview ? css.tokenPreview : ''}`}
      style={
        {
          '--tok-bg': cardColor(token.good),
          '--tok-rim': cardDeep(token.good),
        } as CSSProperties
      }
      aria-label={`${token.good} ${token.value}`}
    >
      <span className={css.tokenVal}>
        {plain ? token.value : formatTokens(rupeesToTokens(token.value))}
      </span>
    </motion.div>
  );
}

const TIER_CLASS: Record<BonusTier, string> = {
  3: css.tier3 ?? '',
  4: css.tier4 ?? '',
  5: css.tier5 ?? '',
};

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
      className={`${css.bonus} ${TIER_CLASS[bonus.tier]}`}
      animate={{ rotateY: show ? 0 : 180 }}
      initial={false}
      transition={{ duration: 0.36, ease: [0.2, 0.7, 0.2, 1] }}
      style={{ transformStyle: 'preserve-3d' }}
    >
      {show ? (
        <span className={css.bonusFace}>+{formatTokens(rupeesToTokens(bonus.value ?? 0))}</span>
      ) : (
        <span className={css.bonusDown} style={{ transform: 'rotateY(180deg)' }}>
          ×{bonus.tier}
          <small>?</small>
        </span>
      )}
    </motion.div>
  );
}

export function BonusPileChip({ tier, preview = false }: { tier: BonusTier; preview?: boolean }) {
  return (
    <div
      className={`${css.bonus} ${TIER_CLASS[tier]} ${preview ? css.bonusPreview : ''}`}
      aria-label={`${tier} 张奖励`}
    >
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
      <Glyph type="camel" size={15} />
      <span>5K</span>
    </span>
  );
}

export function Seal({ earned, animate = true }: { earned: boolean; animate?: boolean }) {
  if (!earned) return <span className={css.sealGhost} aria-label="未获印" />;
  if (!animate) return <span className={css.seal} aria-label="卓越之印">印</span>;
  return (
    <motion.span
      className={css.seal}
      aria-label="卓越之印"
      initial={{ scale: 1.35, rotate: -14, opacity: 0 }}
      animate={{ scale: 1, rotate: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
    >
      印
    </motion.span>
  );
}
