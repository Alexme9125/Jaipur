import { useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { DEFAULT_RULES, GOODS_META } from '@shared/engine';
import { formatTokens } from '@shared/format';
import type { CardType } from '@shared/engine/types';
import { CardView } from './CardView';
import { Sheet } from './Sheet';
import { RulesContent } from './Table';
import { loadProfile, saveProfile, type Profile } from '../game/profile';
import { ThemeToggle } from './ThemeToggle';
import css from './Home.module.css';

const FAN: CardType[] = ['diamond', 'gold', 'silver', 'cloth', 'camel'];

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
  const paneRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  const onMove = (e: React.PointerEvent) => {
    if (reduced || !paneRef.current) return;
    const r = paneRef.current.getBoundingClientRect();
    const dx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    const dy = ((e.clientY - r.top) / r.height - 0.5) * 2;
    setParallax({ x: dx * 6, y: dy * 6 });
  };

  const setName = (name: string) => {
    const p = { ...profile, name: name.trim() || profile.name };
    setProfile(p);
    saveProfile(p);
  };

  return (
    <div className={css.home}>
      <ThemeToggle floating className={css.homeToggle} />
      <div className={css.profileBox}>
        <input
          className={css.nameInput}
          defaultValue={profile.name}
          maxLength={12}
          aria-label="昵称"
          onBlur={(e) => setName(e.target.value)}
        />
        <span className={css.lifetime}>
          累计收入 <b>{formatTokens(profile.lifetimeTokens)}</b> Tokens
        </span>
      </div>

      <div>
        <h1 className={css.wordmark}>Jaipur</h1>
        <p className={css.subtitle}>斋普尔 · 双人香料贸易</p>

        <div className={css.tiles}>
          {props.hasSave && (
            <button type="button" className={css.tile} onClick={props.onResume}>
              <span>
                <span className={css.tileTitle}>继续上一局</span>
                <span className={css.tileSub}>恢复未完成的人机对局</span>
              </span>
              <span className={css.tileArrow}>→</span>
            </button>
          )}
          <button type="button" className={css.tile} onClick={props.onSetup}>
            <span>
              <span className={css.tileTitle}>人机练习</span>
              <span className={css.tileSub}>挑选对手人格，随时练习</span>
            </span>
            <span className={css.tileArrow}>→</span>
          </button>
          <button type="button" className={css.tile} onClick={props.onCreateRoom}>
            <span>
              <span className={css.tileTitle}>创建房间</span>
              <span className={css.tileSub}>生成房间码，发给朋友</span>
            </span>
            <span className={css.tileArrow}>→</span>
          </button>
          <div className={css.tile}>
            <span>
              <span className={css.tileTitle}>加入房间</span>
              <span className={css.tileSub}>输入朋友发来的房间码</span>
            </span>
            <span className={css.joinRow}>
              <input
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
            </span>
          </div>
        </div>
        <button type="button" className={css.rulesLink} onClick={() => setShowRules(true)}>
          规则速览
        </button>
      </div>

      <div className={css.thesis}>
        <div className={css.pane} ref={paneRef} onPointerMove={onMove} onPointerLeave={() => setParallax({ x: 0, y: 0 })}>
          <motion.div className={css.fan} animate={{ x: parallax.x, y: parallax.y }} transition={{ type: 'spring', stiffness: 120, damping: 18 }}>
            {FAN.map((t, i) => (
              <motion.div
                key={t}
                className={css.fanCard}
                animate={{ rotate: -8 + i * 4, y: i === 2 ? -10 : 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 22 }}
              >
                <CardView card={{ id: `fan-${t}`, type: t }} ariaLabel={GOODS_META[t].zh} />
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>

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
