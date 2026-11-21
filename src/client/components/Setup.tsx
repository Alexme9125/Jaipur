import { useState } from 'react';
import { PERSONALITY_META, type Personality } from '@shared/ai';
import { DEFAULT_RULES, RULE_META, type RuleOptions, type RuleValue } from '@shared/engine';
import { botNameFor } from '../game/local';
import { PrimaryButton, Seg, TextButton } from './Controls';
import { ThemeToggle } from './ThemeToggle';
import css from './Setup.module.css';

const PERSONAS: Personality[] = ['cautious', 'balanced', 'aggressive'];
const TONE: Record<Personality, string> = {
  cautious: 'var(--persona-cautious)',
  balanced: 'var(--persona-balanced)',
  aggressive: 'var(--persona-aggressive)',
};
const TAGLINE: Record<Personality, string> = {
  cautious: '控场守成',
  balanced: '审时度势',
  aggressive: '高危连击',
};

export function Setup(props: {
  onStart: (personality: Personality, rules: Partial<RuleOptions>) => void;
  onBack: () => void;
}) {
  const [persona, setPersona] = useState<Personality>('balanced');
  const [rules, setRules] = useState<RuleOptions>({ ...DEFAULT_RULES });
  const [rulesOpen, setRulesOpen] = useState(false);

  const setRule = (key: keyof RuleOptions, value: RuleValue) =>
    setRules((r) => ({ ...r, [key]: value }) as RuleOptions);

  return (
    <div className={css.wrap}>
      <ThemeToggle floating />
      <div className={css.sheet}>
        <header className={css.head}>
          <h2 className={css.title}>人机练习</h2>
          <p className={css.sub}>挑选对手风格。三位对手均会记牌与博弈，先得 2 印赢下整场。</p>
        </header>

        <div className={css.personaRow} role="radiogroup" aria-label="对手人格">
          {PERSONAS.map((p) => {
            const name = botNameFor(p);
            const active = persona === p;
            return (
              <button
                key={p}
                type="button"
                className={css.persona}
                aria-pressed={active}
                style={{ '--tone': TONE[p] } as React.CSSProperties}
                onClick={() => setPersona(p)}
              >
                <span className={css.personaTop}>
                  <span className={css.monogram}>{name.slice(0, 1)}</span>
                  <span className={css.personaMeta}>
                    <span className={css.personaBot}>{name}</span>
                    <span className={css.personaTag}>
                      {PERSONALITY_META[p].label} · {TAGLINE[p]}
                    </span>
                  </span>
                </span>
                <span className={css.personaBlurb}>{PERSONALITY_META[p].blurb}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className={css.rulesToggle}
          aria-expanded={rulesOpen}
          onClick={() => setRulesOpen((v) => !v)}
        >
          <span>规则开关</span>
          <span className={css.rulesArrow}>{rulesOpen ? '收起 ▴' : '展开 ▾'}</span>
        </button>

        {rulesOpen && (
          <div className={css.rulesBody}>
            {RULE_META.filter((m) => m.key !== 'turnTimer').map((m) => (
              <div className={css.ruleRow} key={m.key}>
                <span className={css.ruleLabel}>
                  {m.label}
                  <span className={css.ruleDesc}>{m.description}</span>
                </span>
                <Seg
                  options={m.options as { value: RuleValue; label: string }[]}
                  value={rules[m.key] as RuleValue}
                  onChange={(v) => setRule(m.key, v)}
                  ariaLabel={m.label}
                />
              </div>
            ))}
            <div className={css.resetRow}>
              <TextButton onClick={() => setRules({ ...DEFAULT_RULES })}>恢复官方默认</TextButton>
            </div>
          </div>
        )}

        <div className={css.actions}>
          <button type="button" className={css.back} onClick={props.onBack}>
            返回大厅
          </button>
          <PrimaryButton onClick={() => props.onStart(persona, rules)}>开始对局</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
