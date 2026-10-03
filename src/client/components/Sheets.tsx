import { useEffect } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { SEALS_TO_WIN } from '@shared/engine';
import { formatTokens, rupeesToTokens } from '@shared/format';
import type { PlayerView, RoundPlayerResult } from '@shared/engine';
import { describeRoundEnd } from '../game/describe';
import { Seal } from './Pieces';
import { PrimaryButton, SecondaryButton } from './Controls';
import { Sheet } from './Sheet';
import css from './RoundEnd.module.css';

function CountUp({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => formatTokens(rupeesToTokens(Math.round(v))));
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.6, ease: 'easeOut' });
    return () => c.stop();
  }, [mv, value]);
  return <motion.span>{text}</motion.span>;
}

function Column(props: {
  name: string;
  result: RoundPlayerResult;
  seals: number;
  sealsBefore: number;
}) {
  const r = props.result;
  return (
    <div>
      <div className={css.colHead}>
        <span className={css.colName}>{props.name}</span>
        <span className={css.colSeals}>
          {Array.from({ length: SEALS_TO_WIN }).map((_, i) => (
            <Seal key={i} earned={i < props.seals} animate={i >= props.sealsBefore} />
          ))}
        </span>
      </div>
      <div className={css.row}>
        <span>货物代币</span>
        <b>{formatTokens(rupeesToTokens(r.goods))}</b>
      </div>
      <div className={css.row}>
        <span>奖励代币</span>
        <b>{formatTokens(rupeesToTokens(r.bonus))}</b>
      </div>
      <div className={css.bonusVals}>
        {r.bonusValues.map((v, i) => (
          <motion.span
            key={i}
            className={css.bonusVal}
            initial={{ rotateY: 90, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            transition={{ delay: 0.3 + i * 0.12, duration: 0.3 }}
          >
            +{formatTokens(rupeesToTokens(v))}
          </motion.span>
        ))}
      </div>
      <div className={css.row}>
        <span>骆驼奖励</span>
        <b>{r.camel > 0 ? formatTokens(rupeesToTokens(r.camel)) : '—'}</b>
      </div>
      <div className={css.total}>
        <span className={css.totalLabel}>合计</span>
        <span className={css.totalVal}>
          <CountUp value={r.total} />
        </span>
      </div>
    </div>
  );
}

export function RoundEndSheet(props: {
  view: PlayerView;
  names: [string, string];
  onNext: () => void;
  onRematch: () => void;
  onExit: () => void;
  /** pvp extras */
  spectator?: boolean;
  canRematch?: boolean;
  readySent?: boolean;
  autoRoundSec?: number;
  exitLabel?: string;
}) {
  const { view } = props;
  const me = view.viewer ?? 0;
  const opp = 1 - me;
  const spectator = props.spectator ?? false;
  const r = view.roundResults[view.roundResults.length - 1]!;
  const matchOver = view.phase === 'matchOver';

  const roundResult =
    r.sealWinners.length === 2 || r.sealWinners.length === 0
      ? '本轮平局'
      : !spectator && r.sealWinners[0] === me
        ? '你赢了'
        : `${props.names[r.sealWinners[0] ?? opp] ?? '对手'} 赢下本轮`;

  // R14: on match end the title is the match result; the round info moves to the subtitle
  const winners = view.matchWinners ?? [];
  const title = matchOver
    ? winners.length === 2
      ? '整场平局'
      : !spectator && winners[0] === me
        ? '你赢得整场'
        : `${props.names[winners[0] ?? opp] ?? '对手'} 赢得整场`
    : `第 ${r.round} 轮 · ${roundResult}`;

  const subtitle = matchOver
    ? `第 ${r.round} 轮 · ${roundResult} · ${describeRoundEnd(r.reason)}`
    : describeRoundEnd(r.reason);

  const sealsBefore = (seat: number) =>
    view.players[seat]!.seals - r.sealWinners.filter((w) => w === seat).length;

  const exitLabel = props.exitLabel ?? '返回大厅';

  return (
    <Sheet title={title}>
      <p className={css.reason}>{subtitle}</p>
      <div className={css.cols}>
        <Column
          name={spectator ? (props.names[me] ?? '玩家 1') : '你'}
          result={r.perPlayer[me]!}
          seals={view.players[me]!.seals}
          sealsBefore={sealsBefore(me)}
        />
        <Column
          name={props.names[opp] ?? '对手'}
          result={r.perPlayer[opp]!}
          seals={view.players[opp]!.seals}
          sealsBefore={sealsBefore(opp)}
        />
      </div>
      <div className={css.cumulative}>
        <span>
          {spectator ? props.names[me] : '你'} · 本场累计{' '}
          <b>{formatTokens(rupeesToTokens(view.players[me]!.matchRupees))}</b>
        </span>
        <span>
          {props.names[opp]} · 本场累计{' '}
          <b>{formatTokens(rupeesToTokens(view.players[opp]!.matchRupees))}</b>
        </span>
      </div>
      {!matchOver && props.autoRoundSec !== undefined && (
        <p className={css.autoNext}>{props.autoRoundSec} 秒后自动开始下一轮</p>
      )}
      <div className={css.actions}>
        {matchOver ? (
          <>
            <SecondaryButton onClick={props.onExit}>{exitLabel}</SecondaryButton>
            {(props.canRematch ?? !spectator) && (
              <PrimaryButton onClick={props.onRematch}>再来一局</PrimaryButton>
            )}
          </>
        ) : spectator ? null : (
          <PrimaryButton onClick={props.onNext} disabled={props.readySent}>
            {props.readySent ? '等待对手…' : '下一轮'}
          </PrimaryButton>
        )}
      </div>
    </Sheet>
  );
}
