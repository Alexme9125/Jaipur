import { useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { DEFAULT_RULES, GOODS_META } from '@shared/engine';
import { formatTokens } from '@shared/format';
import type { CardType } from '@shared/engine/types';
import { CardView } from './CardView';
import { Seal, TokenChip } from './Pieces';
import { Sheet } from './Sheet';
import { RulesContent } from './Table';
import { loadProfile, saveProfile, type Profile } from '../game/profile';
import { ThemeToggle } from './ThemeToggle';
import css from './Home.module.css';

const FAN: CardType[] = ['diamond', 'gold', 'silver', 'cloth', 'camel'];

const SHOWCASE_TOKENS = [
  { id: 'home-d', good: 'diamond' as const, value: 7 },
  { id: 'home-g', good: 'gold' as const, value: 6 },
  { id: 'home-s', good: 'spice' as const, value: 5 },
];

export function Home(props: {
  hasSave: boolean;
  onResume: () => void;
  onSetup: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
}) {
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [code, setCode] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  const onMove = (e: React.PointerEvent) => {
    if (reduced || !paneRef.current) return;
    const r = paneRef.current.getBoundingClientRect();
    const dx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    const dy = ((e.clientY - r.top) / r.height - 0.5) * 2;
    setParallax({ x: dx * 5, y: dy * 4 });
  };

  const setName = (name: string) => {
    const p = { ...profile, name: name.trim() || profile.name };
    setProfile(p);
    saveProfile(p);
  };

  return (
    <div className={css.shell}>
      <header className={css.topbar}>
        <span className={css.brandTag}>斋普尔桌游</span>
        <div className={css.topRight}>
          <div className={css.profilePill}>
            <input
              className={css.nameInput}
              defaultValue={profile.name}
              maxLength={12}
              aria-label="昵称"
              onBlur={(e) => setName(e.target.value)}
            />
            <span className={css.pillDivider} aria-hidden="true" />
            <span className={css.lifetime}>
              <b>{formatTokens(profile.lifetimeTokens)}</b>
              <small>Tokens</small>
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className={css.home}>
        <section className={css.intro}>
          <h1 className={css.wordmark}>Jaipur</h1>
          <p className={css.subtitle}>斋普尔 · 双人香料贸易</p>
          <p className={css.lead}>
            收集珍宝与香料，掌控驼队节奏，抢先赢得两枚卓越之印。
          </p>

          <div className={css.actionStack}>
            {props.hasSave && (
              <button type="button" className={css.resumeBanner} onClick={props.onResume}>
                <span className={css.resumeDot} aria-hidden="true" />
                <span className={css.resumeText}>
                  <strong>继续上一局</strong>
                  <span>恢复未完成的人机对局</span>
                </span>
                <span className={css.resumeTag}>继续</span>
              </button>
            )}

            <div className={css.primaryRow}>
              <button type="button" className={css.primaryAction} onClick={props.onSetup}>
                <span className={css.btnTitle}>人机练习</span>
                <span className={css.btnSub}>与不同风格的对手切磋</span>
              </button>
              <button type="button" className={css.secondaryAction} onClick={props.onCreateRoom}>
                <span className={css.btnTitle}>创建房间</span>
                <span className={css.btnSub}>生成房间码邀请好友</span>
              </button>
            </div>

            <div className={css.joinBar}>
              <label className={css.joinLabel} htmlFor="join-code-input">
                加入房间
              </label>
              <div className={css.joinControls}>
                <input
                  id="join-code-input"
                  className={css.codeInput}
                  value={code}
                  maxLength={5}
                  placeholder="房间码"
                  aria-label="房间码"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code.trim()) props.onJoinRoom(code.trim());
                  }}
                />
                <button
                  type="button"
                  className={css.joinBtn}
                  disabled={!code.trim()}
                  onClick={() => props.onJoinRoom(code.trim())}
                >
                  加入
                </button>
              </div>
            </div>
          </div>

          <div className={css.footLinks}>
            <button type="button" className={css.rulesLink} onClick={() => setShowRules(true)}>
              规则速览
            </button>
          </div>
        </section>

        <section className={css.showcase} aria-hidden="true">
          <div
            className={css.mat}
            ref={paneRef}
            onPointerMove={onMove}
            onPointerLeave={() => {
              setParallax({ x: 0, y: 0 });
              setHoveredIdx(null);
            }}
          >
            <div className={css.matInnerFrame} />
            <motion.div
              className={css.fan}
              animate={{ x: parallax.x, y: parallax.y }}
              transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            >
              {FAN.map((t, i) => {
                const baseRot = -10 + i * 5;
                const baseY = Math.abs(i - 2) * 5;
                const isHov = hoveredIdx === i;
                return (
                  <motion.div
                    key={t}
                    className={css.fanCard}
                    style={{ zIndex: isHov ? 10 : i + 1 }}
                    animate={{
                      rotate: isHov ? baseRot * 0.45 : baseRot,
                      y: isHov ? baseY - 14 : baseY,
                    }}
                    transition={
                      reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 22 }
                    }
                    onPointerEnter={() => setHoveredIdx(i)}
                    onPointerLeave={() => setHoveredIdx(null)}
                  >
                    <CardView
                      card={{ id: `fan-${t}`, type: t }}
                      selectable={false}
                      ariaLabel={GOODS_META[t].zh}
                    />
                  </motion.div>
                );
              })}
            </motion.div>

            <div className={css.matPieces}>
              <div className={css.matChips}>
                {SHOWCASE_TOKENS.map((tok, i) => (
                  <span key={tok.id} style={{ zIndex: 3 - i }}>
                    <TokenChip token={tok} />
                  </span>
                ))}
              </div>
              <Seal earned animate={false} />
            </div>
          </div>
        </section>
      </main>

      <AnimatePresence>
        {showRules && (
          <Sheet title="规则" onClose={() => setShowRules(false)} wide>
            <RulesContent rules={DEFAULT_RULES} />
          </Sheet>
        )}
      </AnimatePresence>
    </div>
  );
}
