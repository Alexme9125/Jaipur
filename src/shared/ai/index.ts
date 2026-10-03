import { enumerateActions } from '../engine/actions';
import {
  CAMEL_BONUS,
  CARD_COUNTS,
  GOODS,
  PRECIOUS,
  STALL_LIMIT,
  TIER_MEAN,
  TOKEN_VALUES,
} from '../engine/constants';
import type { PlayerView } from '../engine/view';
import type { Action, ActionContext, BonusTier, Card, CardType, Good, Token } from '../engine/types';

export type Personality = 'cautious' | 'balanced' | 'aggressive';

export const PERSONALITY_META: Record<Personality, { label: string; blurb: string }> = {
  cautious: { label: '谨慎', blurb: '见好就收，少留好牌给下家，爱攒骆驼' },
  balanced: { label: '平衡', blurb: '稳扎稳打，什么机会都看' },
  aggressive: { label: '激进', blurb: '追大额奖励和高价货，敢满手赌一把' },
};

export interface Weights {
  hold: number;
  bonusChase: number;
  exposure: number;
  camelFlex: number;
  /** multiplier on the CAMEL_BONUS term */
  camelMajority: number;
  handComfort: number;
  preciousPref: number;
  competition: number;
  temperature: number;
  /** min token sum (rupees) for a small (1–2 card) cheap sale, unless the round is ending */
  smallSaleMin: number;
}

export const WEIGHTS: Record<Personality, Weights> = {
  cautious: {
    hold: 1.2,
    bonusChase: 1.0,
    exposure: 0.5,
    camelFlex: 1.8,
    camelMajority: 1.6,
    handComfort: 7,
    preciousPref: 0.95,
    competition: 2.0,
    temperature: 1.0,
    smallSaleMin: 5,
  },
  balanced: {
    hold: 1.3,
    bonusChase: 1.3,
    exposure: 0.3,
    camelFlex: 1.2,
    camelMajority: 1.1,
    handComfort: 7,
    preciousPref: 1.15,
    competition: 2.2,
    temperature: 0.5,
    smallSaleMin: 7,
  },
  aggressive: {
    hold: 1.2,
    bonusChase: 1.6,
    exposure: 0.3,
    camelFlex: 1.1,
    camelMajority: 1.0,
    handComfort: 7,
    preciousPref: 1.3,
    competition: 2.4,
    temperature: 0.3,
    smallSaleMin: Infinity,
  },
};

const MAX_EXCHANGE_ACTIONS = 2500;
const SETUP_DECK_SIZE = 40;
const UNKNOWN_BONUS_VALUE = 4;

interface Analysis {
  me: number;
  handCounts: Map<CardType, number>;
  marketCounts: Map<CardType, number>;
  discardCounts: Map<CardType, number>;
  tokensTaken: Map<Good, number>;
  oppHandTotal: number;
  oppHerds: (number | null)[];
  deckCount: number;
  depletedPiles: number;
}

function countTypes(cards: Card[]): Map<CardType, number> {
  const m = new Map<CardType, number>();
  for (const c of cards) m.set(c.type, (m.get(c.type) ?? 0) + 1);
  return m;
}

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

function analyze(view: PlayerView, me: number): Analysis {
  const p = view.players[me]!;
  const discardCounts = countTypes(view.discard);
  const tokensTaken = new Map<Good, number>();
  let depleted = 0;
  for (const g of GOODS) {
    tokensTaken.set(g, TOKEN_VALUES[g].length - view.goodsPiles[g].length);
    if (view.goodsPiles[g].length === 0) depleted++;
  }
  const oppHerds = view.players.map((pl, i) => (i === me ? null : pl.herdCount));
  let oppHandTotal = 0;
  view.players.forEach((pl, i) => {
    if (i !== me) oppHandTotal += pl.handCount;
  });
  return {
    me,
    handCounts: countTypes(p.hand ?? []),
    marketCounts: countTypes(view.market),
    discardCounts,
    tokensTaken,
    oppHandTotal,
    oppHerds,
    deckCount: view.deckCount,
    depletedPiles: depleted,
  };
}

/* ---------- scoring components ---------- */

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function expectedOpponentHolding(
  a: Analysis,
  g: Good,
  ownCount: number,
  soldCounts: Map<CardType, number>,
): number {
  const total = CARD_COUNTS[g];
  const unseen = Math.max(
    0,
    total - ownCount - (a.marketCounts.get(g) ?? 0) - (soldCounts.get(g) ?? 0),
  );
  const denom = a.deckCount + a.oppHandTotal;
  return denom > 0 ? (unseen * a.oppHandTotal) / denom : 0;
}

/**
 * Cards of `g` accounted for by sales — the discard when it is browsable,
 * otherwise tokens-taken as the proxy (sold cards land in the discard, so
 * subtracting both would double count).
 */
function soldCountsFor(view: PlayerView, a: Analysis, sim?: Sim): Map<CardType, number> {
  if (view.rules.discardBrowsable) {
    const m = new Map(a.discardCounts);
    if (sim) for (const [t, n] of sim.soldAdded) m.set(t, (m.get(t) ?? 0) + n);
    return m;
  }
  const tt = sim?.tokensTakenAfter ?? a.tokensTaken;
  const m = new Map<CardType, number>();
  for (const g of GOODS) m.set(g, tt.get(g) ?? 0);
  return m;
}

function potential(
  view: PlayerView,
  a: Analysis,
  counts: Map<CardType, number>,
  handSize: number,
  w: Weights,
  piles: Record<Good, { value: number }[]>,
  bonusCounts: Record<BonusTier, number>,
  soldCounts: Map<CardType, number>,
): number {
  let pot = 0;
  for (const g of GOODS) {
    const c = counts.get(g) ?? 0;
    if (c === 0) continue;
    const pile = piles[g];
    const s = Math.round(w.competition * expectedOpponentHolding(a, g, c, soldCounts));
    let v = 0;
    for (let i = s; i < Math.min(pile.length, s + c); i++) v += pile[i]!.value;
    if (PRECIOUS.includes(g)) v *= w.preciousPref;
    // a lone card can't complete a set — precious singles count at 0.5×
    // (spec); cheap singles count even lower so set-seeking emerges
    if (c === 1) v *= PRECIOUS.includes(g) ? 0.5 : 0.2;
    if (c >= 3) {
      const tier: BonusTier = c >= 5 ? 5 : c === 4 ? 4 : 3;
      if (bonusCounts[tier] > 0) v += w.bonusChase * TIER_MEAN[tier];
    }
    pot += v;
  }
  if (handSize > w.handComfort) pot *= w.handComfort / handSize;
  // discount as the round end nears: unsold cards are worth 0
  const f = a.deckCount / SETUP_DECK_SIZE;
  const deckFactor = 0.3 + 0.7 * f;
  pot *= deckFactor * (1 - 0.25 * a.depletedPiles);
  return pot;
}

function assumedOppHerd(a: Analysis, ownHerd: number): number {
  const known: number[] = [ownHerd];
  for (const h of a.oppHerds) if (h !== null) known.push(h);
  return known.length > 0 ? known.reduce((x, y) => x + y, 0) / known.length : 2;
}

function camelValue(a: Analysis, h: number, w: Weights): number {
  const assumed = assumedOppHerd(a, h);
  let maxOpp = 0;
  for (const oh of a.oppHerds) maxOpp = Math.max(maxOpp, oh ?? assumed);
  return (
    w.camelMajority * CAMEL_BONUS * sigmoid((h - maxOpp - 0.5) / 1.5) +
    w.camelFlex * 0.4 * Math.min(h, 4)
  );
}

function exposureAfter(
  view: PlayerView,
  marketAfter: Card[],
  unknownSlots: number,
): number {
  const counts = countTypes(marketAfter);
  let best = (counts.get('camel') ?? 0) * 0.6;
  for (const g of GOODS) {
    const c = counts.get(g) ?? 0;
    if (c === 0) continue;
    const top = view.goodsPiles[g][0]?.value ?? 0;
    best = Math.max(best, c >= 2 ? 2 * top : top);
  }
  return best + 1.0 * unknownSlots;
}

function sellImmediate(view: PlayerView, good: Good, count: number): number {
  const pile = view.goodsPiles[good];
  let v = 0;
  for (let i = 0; i < Math.min(pile.length, count); i++) v += pile[i]!.value;
  if (count >= 3) {
    const tier: BonusTier = count >= 5 ? 5 : count === 4 ? 4 : 3;
    if (view.bonusPileCounts[tier] > 0) v += TIER_MEAN[tier];
  }
  return v;
}

/* ---------- per-action simulation on public info ---------- */

interface Sim {
  handCounts: Map<CardType, number>;
  handSize: number;
  herd: number;
  marketAfter: Card[];
  unknownSlots: number;
  immediate: number;
  gainedTokens: number;
  gainedBonus: boolean;
  endsRound: boolean;
  /** goods piles after the action (post-sale piles are shifted) */
  piles: Record<Good, Token[]>;
  bonusCounts: Record<BonusTier, number>;
  /** cards this action put into the discard */
  soldAdded: Map<CardType, number>;
  tokensTakenAfter: Map<Good, number>;
}

function simulate(view: PlayerView, a: Analysis, action: Action): Sim {
  const p = view.players[a.me]!;
  const herd0 = p.herdIds?.length ?? 0;
  const handCounts = new Map(a.handCounts);
  const dec = (t: CardType) => handCounts.set(t, (handCounts.get(t) ?? 0) - 1);
  const inc = (t: CardType) => handCounts.set(t, (handCounts.get(t) ?? 0) + 1);

  const sim: Sim = {
    handCounts,
    handSize: p.handCount,
    herd: herd0,
    marketAfter: view.market,
    unknownSlots: 0,
    immediate: 0,
    gainedTokens: 0,
    gainedBonus: false,
    endsRound: false,
    piles: view.goodsPiles,
    bonusCounts: view.bonusPileCounts,
    soldAdded: new Map(),
    tokensTakenAfter: a.tokensTaken,
  };

  const deckEnds = (needed: number) =>
    view.rules.deckEndTrigger === 'deckEmpty'
      ? a.deckCount <= needed
      : a.deckCount < needed;

  switch (action.type) {
    case 'take': {
      const card = view.market.find((c) => c.id === action.cardId)!;
      inc(card.type);
      sim.handSize += 1;
      sim.marketAfter = view.market.filter((c) => c.id !== action.cardId);
      sim.unknownSlots = Math.min(1, a.deckCount);
      sim.endsRound = deckEnds(1);
      break;
    }
    case 'camels': {
      const n = view.market.filter((c) => c.type === 'camel').length;
      sim.herd += n;
      sim.marketAfter = view.market.filter((c) => c.type !== 'camel');
      sim.unknownSlots = Math.min(n, a.deckCount);
      sim.endsRound = deckEnds(n);
      break;
    }
    case 'exchange': {
      const takenIdx = new Set<number>();
      for (const id of action.take) {
        const i = view.market.findIndex((c) => c.id === id);
        if (i >= 0) takenIdx.add(i);
      }
      const taken = view.market.filter((_, i) => takenIdx.has(i));
      const handById = new Map((p.hand ?? []).map((c) => [c.id, c]));
      const herdIds = new Set(p.herdIds ?? []);
      let gaveCamels = 0;
      const given: Card[] = [];
      for (const id of action.give) {
        const c = handById.get(id);
        if (c) {
          dec(c.type);
          sim.handSize -= 1;
          given.push(c);
        } else if (herdIds.has(id)) {
          gaveCamels++;
          given.push({ id, type: 'camel' });
        }
      }
      for (const c of taken) {
        if (c.type === 'camel') sim.herd += 1;
        else {
          inc(c.type);
          sim.handSize += 1;
        }
      }
      sim.herd -= gaveCamels;
      sim.marketAfter = view.market.filter((_, i) => !takenIdx.has(i)).concat(given);
      sim.endsRound = a.deckCount === 0 && view.stallCount + 1 >= STALL_LIMIT;
      break;
    }
    case 'sell': {
      const ids = new Set(action.cardIds);
      const sold = (p.hand ?? []).filter((c) => ids.has(c.id));
      const good = sold[0]?.type as Good;
      for (const c of sold) {
        dec(c.type);
        sim.handSize -= 1;
      }
      const pile = view.goodsPiles[good] ?? [];
      const n = Math.min(pile.length, sold.length);
      for (let i = 0; i < n; i++) sim.gainedTokens += pile[i]!.value;
      sim.immediate = sellImmediate(view, good, sold.length);
      // post-sale piles: the tokens the bot just took are gone, and the
      // bonus stack may have shrunk — potential must use these, not the
      // current piles
      sim.piles = { ...view.goodsPiles, [good]: pile.slice(n) };
      sim.tokensTakenAfter = new Map(a.tokensTaken);
      sim.tokensTakenAfter.set(good, (a.tokensTaken.get(good) ?? 0) + n);
      sim.soldAdded.set(good, sold.length);
      if (sold.length >= 3) {
        const tier: BonusTier = sold.length >= 5 ? 5 : sold.length === 4 ? 4 : 3;
        sim.gainedBonus = view.bonusPileCounts[tier] > 0;
        if (sim.gainedBonus) {
          sim.bonusCounts = { ...view.bonusPileCounts, [tier]: view.bonusPileCounts[tier] - 1 };
        }
      }
      const depleted = a.depletedPiles + (pile.length <= sold.length && pile.length > 0 ? 1 : 0);
      sim.endsRound = depleted >= 3;
      break;
    }
  }
  return sim;
}

function endgameScore(view: PlayerView, a: Analysis, sim: Sim): number {
  if (!sim.endsRound) return 0;
  const herds = view.players.map((pl, i) =>
    i === a.me ? sim.herd : pl.herdCount ?? Math.round(assumedOppHerd(a, sim.herd)),
  );
  const maxHerd = Math.max(...herds);
  const leaders = herds.filter((h) => h === maxHerd).length;
  const totals = view.players.map((pl, i) => {
    let t = pl.goodsTokens.reduce((x, tok) => x + tok.value, 0);
    for (const b of pl.bonusTokens) t += b.value ?? UNKNOWN_BONUS_VALUE;
    if (i === a.me) {
      t += sim.gainedTokens;
      if (sim.gainedBonus) t += UNKNOWN_BONUS_VALUE;
    }
    if (herds[i] === maxHerd && (leaders === 1 || view.rules.camelTie === 'all')) t += CAMEL_BONUS;
    return t;
  });
  const mine = totals[a.me]!;
  const strictlyLeading = totals.every((t, i) => i === a.me || mine > t);
  return strictlyLeading ? 15 : -15;
}

/* ---------- public API ---------- */

function scoreAction(view: PlayerView, a: Analysis, action: Action, w: Weights): number {
  const sim = simulate(view, a, action);
  const potBefore = potential(
    view,
    a,
    a.handCounts,
    view.players[a.me]!.handCount,
    w,
    view.goodsPiles,
    view.bonusPileCounts,
    soldCountsFor(view, a),
  );
  const potAfter = potential(
    view,
    a,
    sim.handCounts,
    sim.handSize,
    w,
    sim.piles,
    sim.bonusCounts,
    soldCountsFor(view, a, sim),
  );
  const herdBefore = view.players[a.me]!.herdIds?.length ?? 0;
  const dCamel = camelValue(a, sim.herd, w) - camelValue(a, herdBefore, w);
  const exposure = exposureAfter(view, sim.marketAfter, sim.unknownSlots);
  const endgame = endgameScore(view, a, sim);
  return (
    sim.immediate + w.hold * (potAfter - potBefore) - w.exposure * exposure + dCamel + endgame
  );
}

/** Score a single action for a seat under a personality's weights (tests/tools). */
export function scoreActionFor(
  view: PlayerView,
  seat: number,
  action: Action,
  personality: Personality,
): number {
  return scoreAction(view, analyze(view, seat), action, WEIGHTS[personality]);
}

function pick(view: PlayerView, w: Weights, rng: () => number): Action {
  const me = view.viewer;
  if (me === null) throw new Error('chooseAction needs a seated player view');
  const ctx = actionContextFromView(view, me);
  let actions = enumerateActions(ctx);
  if (actions.length === 0) throw new Error('no legal action');
  // bound worst-case enumeration cost
  if (actions.length > MAX_EXCHANGE_ACTIONS + 64) {
    const nonExchange: Action[] = actions.filter((a) => a.type !== 'exchange');
    const exchanges: Action[] = actions.filter((a) => a.type === 'exchange');
    actions = nonExchange.concat(exchanges.slice(0, MAX_EXCHANGE_ACTIONS));
  }
  const a = analyze(view, me);
  // Sale discipline: a sale spends the whole turn. Small cheap sales (1–2
  // cards) are filtered out unless the round end is near, the tokens they'd
  // take are worth at least smallSaleMin, or nothing else is legal.
  const nearEnd = a.depletedPiles >= 2 || a.deckCount <= 6;
  const handById = new Map(ctx.hand.map((c) => [c.id, c]));
  const big = actions.filter((act) => {
    if (act.type !== 'sell') return true;
    const t = handById.get(act.cardIds[0]!)!.type;
    // precious sales are already ≥2 by the rules
    if (PRECIOUS.includes(t as Good) || act.cardIds.length >= 3) return true;
    if (nearEnd) return true;
    const pile = ctx.goodsPiles[t as Good];
    const sum = pile.slice(0, act.cardIds.length).reduce((s, tk) => s + tk.value, 0);
    return sum >= w.smallSaleMin;
  });
  const pool = big.length > 0 ? big : actions;
  const scored = pool.map((act) => ({ act, s: scoreAction(view, a, act, w) }));
  scored.sort((x, y) => y.s - x.s);
  if (w.temperature <= 0) return scored[0]!.act;
  const top = scored.slice(0, 5);
  const max = top[0]!.s;
  const exps = top.map((t) => Math.exp((t.s - max) / w.temperature));
  const sum = exps.reduce((x, y) => x + y, 0);
  let r = rng() * sum;
  for (let i = 0; i < top.length; i++) {
    r -= exps[i]!;
    if (r <= 0) return top[i]!.act;
  }
  return top[top.length - 1]!.act;
}

export function chooseAction(
  view: PlayerView,
  personality: Personality,
  rng: () => number,
): Action {
  return pick(view, WEIGHTS[personality], rng);
}

/** Hint for PVE: balanced weights, temperature 0 (pure argmax). */
export function suggestAction(view: PlayerView): Action {
  return pick(view, { ...WEIGHTS.balanced, temperature: 0 }, () => 0);
}
