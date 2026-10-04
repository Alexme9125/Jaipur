import type { ReactNode } from 'react';
import type { Personality } from '@shared/ai';
import { PERSONALITY_META } from '@shared/ai';
import css from './Controls.module.css';

export function PrimaryButton(props: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={css.primary}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.ariaLabel}
    >
      {props.children}
    </button>
  );
}

export function SecondaryButton(props: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={css.secondary}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.ariaLabel}
    >
      {props.children}
    </button>
  );
}

export function TextButton(props: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className={css.textBtn} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

const DOT_COLOR: Record<Personality, string> = {
  cautious: 'var(--persona-cautious)',
  balanced: 'var(--persona-balanced)',
  aggressive: 'var(--persona-aggressive)',
};

export function PersonalityChip({ p }: { p: Personality }) {
  return (
    <span className={css.chip}>
      <span className={css.chipDot} style={{ background: DOT_COLOR[p] }} />
      {PERSONALITY_META[p].label}
    </span>
  );
}

export function Stepper(props: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <span className={css.stepper} role="group" aria-label={props.label}>
      <button
        type="button"
        aria-label="减少"
        disabled={props.value <= props.min}
        onClick={() => props.onChange(props.value - 1)}
      >
        −
      </button>
      <span className={css.stepperVal}>{props.value}</span>
      <button
        type="button"
        aria-label="增加"
        disabled={props.value >= props.max}
        onClick={() => props.onChange(props.value + 1)}
      >
        +
      </button>
    </span>
  );
}

export function Seg<T extends string | number | boolean>(props: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className={css.seg} role="group" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === props.value}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
