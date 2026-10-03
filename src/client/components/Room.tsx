import { useEffect, useState } from 'react';
import { RULE_META, type RuleOptions, type RuleValue } from '@shared/engine';
import type { SeatPublic } from '@shared/protocol';
import type { RemoteDriver, RemoteMeta } from '../game/remote';
import { PrimaryButton, SecondaryButton, Seg } from './Controls';
import { RulesContent } from './Table';
import css from './Room.module.css';

function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const remain = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <span className={css.offline}>掉线 · 等待重连 {remain}s</span>;
}

function SeatCard({
  seat,
  index,
  canSit,
  onSit,
}: {
  seat: SeatPublic | null;
  index: 0 | 1;
  canSit: boolean;
  onSit: (i: 0 | 1) => void;
}) {
  if (!seat) {
    return (
      <div className={`${css.seat} ${css.seatEmpty}`}>
        <span>空座</span>
        {canSit && (
          <SecondaryButton onClick={() => onSit(index)} ariaLabel="坐下">
            坐下
          </SecondaryButton>
        )}
      </div>
    );
  }
  return (
    <div className={css.seat}>
      <span className={css.avatar}>{seat.name.slice(0, 1)}</span>
      <span className={css.seatMain}>
        <span className={css.seatName}>{seat.name}</span>
        <span className={css.seatTags}>
          {seat.isHost && <span className={css.tag}>房主</span>}
          {seat.isYou && <span className={`${css.tag} ${css.tagYou}`}>你</span>}
          {!seat.connected && seat.reconnectDeadline && (
            <Countdown deadline={seat.reconnectDeadline} />
          )}
        </span>
      </span>
      <span className={`${css.dot} ${seat.connected ? css.dotOn : css.dotOff}`} />
    </div>
  );
}

export function Room({
  driver,
  meta,
  onLeave,
}: {
  driver: RemoteDriver;
  meta: RemoteMeta;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const room = meta.room;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  if (!room) {
    return (
      <main className={css.page}>
        <div className={css.topbar}>
          <span className={css.wordmark}>
            Jaipur<em>· 房间</em>
          </span>
          <SecondaryButton onClick={onLeave}>离开房间</SecondaryButton>
        </div>
        <p className={css.connState}>
          {meta.connected ? '进入房间…' : '连接中…'}
        </p>
      </main>
    );
  }

  const me = room.you.role === 'seat' ? room.you.seat : null;
  const isHost = room.isHost;
  const bothSeated = room.seats.every((s) => s !== null && s.connected);
  const canSit = me === null;
  const seated = me !== null;

  const setRule = (key: keyof RuleOptions, v: RuleValue) =>
    driver.setRules({ ...room.rules, [key]: v } as RuleOptions);

  const copyLink = async () => {
    const url = `${location.origin}/r/${room.code}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard unavailable */
    }
    setCopied(true);
  };

  const rulesPanel = (
    <div className={`${css.panel} ${css.rulesPanel} ${rulesOpen ? css.open : ''}`}>
      <div className={css.panelTitle}>规则 · {isHost ? '房主可改' : '只读'}</div>
      {isHost
        ? RULE_META.map((m) => (
            <div key={m.key} className={css.ruleRow}>
              <span className={css.ruleLabel}>
                {m.label}
                <span className={css.ruleDesc}>{m.description}</span>
              </span>
              <Seg
                options={m.options as { value: RuleValue; label: string }[]}
                value={room.rules[m.key] as RuleValue}
                onChange={(v) => setRule(m.key, v)}
                ariaLabel={m.label}
              />
            </div>
          ))
        : <RulesContent rules={room.rules} />}
    </div>
  );

  return (
    <main className={css.page}>
      <div className={css.topbar}>
        <span className={css.wordmark}>
          Jaipur<em>· 房间</em>
        </span>
        <SecondaryButton onClick={onLeave}>离开房间</SecondaryButton>
      </div>
      <div className={css.main}>
        <div className={css.leftCol}>
          <div className={css.arena}>
            <span className={css.etch}>Jaipur</span>
            <SeatCard seat={room.seats[1]} index={1} canSit={canSit} onSit={(i) => driver.sit(i)} />
            <SeatCard seat={room.seats[0]} index={0} canSit={canSit} onSit={(i) => driver.sit(i)} />
          </div>
          <div className={css.arenaFoot}>
            {isHost ? (
              <PrimaryButton
                onClick={() => driver.start()}
                disabled={!bothSeated}
                ariaLabel="开始对局"
              >
                开始对局
              </PrimaryButton>
            ) : (
              <span className={css.hint}>等待房主开局</span>
            )}
            {seated && (
              <SecondaryButton onClick={() => driver.stand()}>站起</SecondaryButton>
            )}
            {isHost && !bothSeated && (
              <span className={css.hint}>两个座位都坐满后才能开局</span>
            )}
            {!meta.connected && <span className={css.hint}>连接中断，正在重连…</span>}
          </div>
        </div>
        <div className={css.side}>
          <div className={css.codeCard}>
            <div className={css.codeLabel}>房间码</div>
            <div className={css.code}>{room.code}</div>
            <div style={{ marginTop: 12 }}>
              <SecondaryButton onClick={copyLink} ariaLabel="复制邀请链接">
                {copied ? '已复制' : '复制邀请链接'}
              </SecondaryButton>
            </div>
            {room.lastMatch && (
              <p className={css.lastMatch} style={{ marginTop: 10 }}>
                上一场：
                {room.lastMatch.winners.length === 2
                  ? '平局'
                  : `${room.lastMatch.names[room.lastMatch.winners[0] ?? 0]} 获胜`}
              </p>
            )}
          </div>
          <div className={`${css.panel} ${css.specPanel}`}>
            <div className={css.panelTitle}>旁观 · {room.spectators.length} 人</div>
            <div className={css.specList}>
              {room.spectators.length === 0 && <span className={css.specEmpty}>暂无旁观者</span>}
              {room.spectators.map((s, i) => (
                <span key={i} className={css.specName}>
                  {s.name}
                  {s.isYou ? '（你）' : ''}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            className={css.rulesToggleM}
            aria-expanded={rulesOpen}
            onClick={() => setRulesOpen((v) => !v)}
          >
            <span>规则</span>
            <span>{rulesOpen ? '收起 ▴' : '展开 ▾'}</span>
          </button>
          {rulesPanel}
        </div>
      </div>
    </main>
  );
}
