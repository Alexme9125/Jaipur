import { enumerateActions } from '../engine/actions';
import { CAMEL_BONUS, PRECIOUS } from '../engine/constants';
import type { Action, ActionContext, Good } from '../engine/types';
import type { PlayerView } from '../engine/view';
import {
  baseStateValues,
  buildBoardContext,
  inferPlanGood,
  scoreAction1Ply,
  scoreAction2Ply,
  simulateAction,
  WEIGHTS,
  type Personality,
  type SimOutcome,
  type Weights,
} from './evaluator';
import {
  buildOpponentBelief,
  createBotMemory,
  observeBotMemory,
  type BotMemory,
  type OpponentBelief,
} from './memory';

export { WEIGHTS, type Personality, type Weights } from './evaluator';
export {
  buildOpponentBelief,
  createBotMemory,
  observeBotMemory,
  type BotMemory,
  type OpponentBelief,
} from './memory';

export const PERSONALITY_META: Record<Personality, { label: string; blurb: string }> = {
  cautious: {
    label: '谨慎',
    blurb: '善于记牌控场，紧守骆驼优势，见好就收不给对手留缝',
  },
  balanced: {
    label: '平衡',
    blurb: '审时度势，灵活衔接连击与高价货抢跑，节奏收放自如',
  },
  aggressive: {
    label: '激进',
    blurb: '执着四五连大额奖励，善用大交换清扫市场，敢满手搏高分',
  },
};

export type ThinkingComplexity = 'snap' | 'normal' | 'deep';

export interface BotDecision {
  action: Action;
  complexity: ThinkingComplexity;
  /** Natural human-like thinking time (ms) calibrated to decision difficulty & personality */
  thinkingMs: number;
  /** Score gap between best and second-best move */
  margin: number;
}

const MAX_EXCHANGE_ACTIONS = 2000;
const TOP_EXCHANGE_REFINE = 10;

/** Build the shared legality context for the given seat from its PlayerView. */
export function actionContextFromView(view: PlayerView, me: number): ActionContext {
  const p = view.players[me]!;
  return {
    rules: view.rules,
    market: view.market,
    hand: p.hand ?? [],
    herd: (p.herdIds ?? []).map((id) => ({ id, type: 'camel' as const })),
    goodsPiles: view.goodsPiles,
    deckCount: view.deckCount,
  };
}

/**
 * Dynamically adapts a personality's base weights to live round & match context
 * (trailing late -> bolder; comfortably ahead late -> tighter & sharper close).
 */
function adaptWeights(
  base: Weights,
  view: PlayerView,
  me: number,
  scoreLead: number,
  horizon: number,
  oppComboBias: number,
): Weights {
  const w: Weights = { ...base };
  const selfP = view.players[me]!;
  const oppP = view.players[1 - me]!;

  // Late-round score-dependent gear shift
  if (horizon < 0.4) {
    if (scoreLead < -6) {
      // Trailing late: push harder for high-value bonuses and avoid locking a loss
      w.bonusChase *= 1.14;
      w.closeUrgency *= 0.85;
      w.refillCaution *= 0.88;
    } else if (scoreLead > 7) {
      // Leading comfortably late: protect lead, close out cleanly
      w.closeUrgency *= 1.18;
      w.refillCaution *= 1.16;
      if (Number.isFinite(w.smallSaleMin)) w.smallSaleMin = Math.min(w.smallSaleMin, 4);
    }
  }

  // Opponent match-point pressure (0-1 down in seals): resist passive play
  if (oppP.seals > selfP.seals && scoreLead < 0) {
    w.bonusChase *= 1.08;
    w.denial *= 1.1;
  }

  // Subtle adaptation to opponent's observed combo tendency across the match
  if (oppComboBias > 0.65) {
    // Opponent hoards big sets -> slightly more value on denial and faster token racing
    w.denial *= 1.1;
    w.competition *= 1.08;
  } else if (oppComboBias < 0.35) {
    // Opponent sells small & fast -> race precious piles a bit earlier
    w.competition *= 1.1;
  }

  return w;
}

/** Score a single action for a seat under a personality's weights (tests/tools). */
export function scoreActionFor(
  view: PlayerView,
  seat: number,
  action: Action,
  personality: Personality,
  memory?: BotMemory,
): number {
  const belief = buildOpponentBelief(view, seat, memory);
  const ctx = buildBoardContext(view, seat, belief, memory);
  const w = WEIGHTS[personality];
  const { potBefore, camelBefore } = baseStateValues(view, ctx, w);
  const sim = simulateAction(view, ctx, action);
  return scoreAction2Ply(view, ctx, sim, w, potBefore, camelBefore);
}

function cadenceScale(personality: Personality): number {
  if (personality === 'aggressive') return 0.88;
  if (personality === 'cautious') return 1.1;
  return 1.0;
}

function computePacing(
  personality: Personality,
  chosen: Action,
  margin: number,
  poolSize: number,
  deckCount: number,
  depletedPiles: number,
  rng: () => number,
): { complexity: ThinkingComplexity; thinkingMs: number } {
  const scale = cadenceScale(personality);
  const jitter = (rng() - 0.5) * 260;

  if (poolSize <= 1 || (margin >= 6.0 && chosen.type !== 'exchange')) {
    const ms = Math.round(Math.max(480, (660 + jitter * 0.7) * scale));
    return { complexity: 'snap', thinkingMs: ms };
  }

  const tenseEndgame = deckCount <= 8 || depletedPiles >= 2;
  const bigExchange = chosen.type === 'exchange' && chosen.take.length >= 3;
  if (margin <= 1.7 || bigExchange || (tenseEndgame && margin <= 3.5)) {
    const ms = Math.round(Math.max(1150, (1620 + jitter * 1.3) * scale));
    return { complexity: 'deep', thinkingMs: ms };
  }

  const ms = Math.round(Math.max(720, (1080 + jitter) * scale));
  return { complexity: 'normal', thinkingMs: ms };
}

function pickDecision(
  view: PlayerView,
  personality: Personality,
  baseWeights: Weights,
  rng: () => number,
  memory?: BotMemory,
): BotDecision {
  const me = view.viewer;
  if (me === null) throw new Error('chooseAction needs a seated player view');

  if (memory) observeBotMemory(memory, view, me);

  const actCtx = actionContextFromView(view, me);
  let actions = enumerateActions(actCtx);
  if (actions.length === 0) throw new Error('no legal action');

  if (actions.length > MAX_EXCHANGE_ACTIONS + 64) {
    const nonExchange = actions.filter((a) => a.type !== 'exchange');
    const exchanges = actions.filter((a) => a.type === 'exchange');
    actions = [...nonExchange, ...exchanges.slice(0, MAX_EXCHANGE_ACTIONS)];
  }

  const belief = buildOpponentBelief(view, me, memory);
  const ctx = buildBoardContext(view, me, belief, memory);
  const { horizonBefore } = baseStateValues(view, ctx, baseWeights);

  const camelDiff =
    ctx.myHerd > belief.oppHerdEst
      ? CAMEL_BONUS
      : belief.oppHerdEst > ctx.myHerd
        ? -CAMEL_BONUS
        : 0;
  const scoreLead = ctx.myScoreNow - ctx.oppScoreNow + camelDiff;

  const w = adaptWeights(baseWeights, view, me, scoreLead, horizonBefore, belief.oppComboBias);
  const { potBefore, camelBefore } = baseStateValues(view, ctx, w);

  // Sale discipline:
  // 1) Avoid nonsensical partial sales (selling k < fullCount of a good) unless
  //    selling all would deplete the 3rd pile and prematurely end the round.
  // 2) Filter out low-value 1–2 card cheap sales unless endgame is near.
  const sortedPiles = [...ctx.pileLens].sort((a, b) => a - b);
  const thirdPileLen = sortedPiles[2]!;
  const nearEnd =
    personality === 'aggressive'
      ? false
      : personality === 'balanced'
        ? (ctx.depletedPiles >= 2 && thirdPileLen <= 2) || ctx.deckCount <= 3
        : ctx.depletedPiles >= 2 || ctx.deckCount <= 6;
  const handById = new Map(actCtx.hand.map((c) => [c.id, c]));
  const handCountByGood = new Map<Good, number>();
  for (const c of actCtx.hand) {
    if (c.type !== 'camel') {
      handCountByGood.set(c.type, (handCountByGood.get(c.type) ?? 0) + 1);
    }
  }
  const filtered = actions.filter((act) => {
    if (act.type !== 'sell') return true;
    const t = handById.get(act.cardIds[0]!)!.type as Good;
    const owned = handCountByGood.get(t) ?? act.cardIds.length;
    const pile = actCtx.goodsPiles[t];
    // Never sell 1–2 cards into an already-empty pile (0 tokens + 0 bonus = pure pass)
    if (act.cardIds.length < 3 && pile.length === 0) return false;
    if (act.cardIds.length < owned) {
      // Keep a partial sale only if selling all would end the round on tokens AND we keep ≥2 cards sold
      const fullEndsRound = ctx.depletedPiles >= 2 && pile.length > 0 && owned >= pile.length;
      if (!fullEndsRound || act.cardIds.length < 2) return false;
    }
    if (PRECIOUS.includes(t) || act.cardIds.length >= 3) return true;
    // Always allow a sale that immediately closes the 3rd pile
    if (ctx.depletedPiles >= 2 && pile.length > 0 && act.cardIds.length >= pile.length) {
      return personality !== 'aggressive' || act.cardIds.length >= 2 || scoreLead > 2;
    }
    if (nearEnd) {
      const sum = pile.slice(0, act.cardIds.length).reduce((s, tk) => s + tk.value, 0);
      return sum >= (personality === 'balanced' ? 3 : 1);
    }
    const sum = pile.slice(0, act.cardIds.length).reduce((s, tk) => s + tk.value, 0);
    return sum >= w.smallSaleMin;
  });
  const pool = filtered.length > 0 ? filtered : actions;

  // Stage 1: Fast 1-ply evaluation of all candidates
  const nonExScored: { act: Action; s1: number; sim: SimOutcome }[] = [];
  const exScored: { act: Action; s1: number; sim: SimOutcome }[] = [];

  for (const act of pool) {
    const { score, sim } = scoreAction1Ply(view, ctx, act, w, potBefore, camelBefore);
    if (act.type === 'exchange') exScored.push({ act, s1: score, sim });
    else nonExScored.push({ act, s1: score, sim });
  }

  exScored.sort((x, y) => y.s1 - x.s1);
  const shortlist = nonExScored.concat(exScored.slice(0, TOP_EXCHANGE_REFINE));

  // Stage 2: Deep 2-ply tactical refinement on shortlist
  const refined = shortlist.map((item) => ({
    act: item.act,
    sim: item.sim,
    s: scoreAction2Ply(view, ctx, item.sim, w, potBefore, camelBefore),
  }));
  refined.sort((x, y) => y.s - x.s);

  const best = refined[0]!;
  const second = refined[1];
  const margin = second ? best.s - second.s : 10;

  let chosen = best;
  if (w.temperature > 0 && refined.length > 1) {
    // Only sample among genuinely competitive moves close to the best — lively without blunders
    const maxGap = Math.max(0.85, w.temperature * 3.8);
    const contenders = refined.slice(0, 4).filter((c) => best.s - c.s <= maxGap);
    if (contenders.length > 1) {
      const exps = contenders.map((c) => Math.exp((c.s - best.s) / w.temperature));
      const sum = exps.reduce((a, b) => a + b, 0);
      let r = rng() * sum;
      chosen = contenders[contenders.length - 1]!;
      for (let i = 0; i < contenders.length; i++) {
        r -= exps[i]!;
        if (r <= 0) {
          chosen = contenders[i]!;
          break;
        }
      }
    }
  }

  if (memory) {
    memory.planGood = inferPlanGood(chosen.sim);
  }

  const pacing = computePacing(
    personality,
    chosen.act,
    margin,
    pool.length,
    ctx.deckCount,
    ctx.depletedPiles,
    rng,
  );

  return {
    action: chosen.act,
    complexity: pacing.complexity,
    thinkingMs: pacing.thinkingMs,
    margin,
  };
}

export function chooseActionWithMeta(
  view: PlayerView,
  personality: Personality,
  rng: () => number,
  memory?: BotMemory,
): BotDecision {
  return pickDecision(view, personality, WEIGHTS[personality], rng, memory);
}

export function chooseAction(
  view: PlayerView,
  personality: Personality,
  rng: () => number,
  memory?: BotMemory,
): Action {
  return pickDecision(view, personality, WEIGHTS[personality], rng, memory).action;
}

/** Hint for PVE: balanced 2-ply tactical search, temperature 0 (pure argmax). */
export function suggestAction(view: PlayerView, memory?: BotMemory): Action {
  return pickDecision(
    view,
    'balanced',
    { ...WEIGHTS.balanced, temperature: 0 },
    () => 0,
    memory,
  ).action;
}
