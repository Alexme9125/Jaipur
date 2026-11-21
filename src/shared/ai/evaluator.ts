import {
  CAMEL_BONUS,
  GOODS,
  HAND_LIMIT,
  SEALS_TO_WIN,
  STALL_LIMIT,
  TIER_MEAN,
  TOKEN_VALUES,
} from '../engine/constants';
import type { Action, BonusTier, Card, Good, Token } from '../engine/types';
import type { PlayerView } from '../engine/view';
import type { BotMemory, OpponentBelief } from './memory';

export type Personality = 'cautious' | 'balanced' | 'aggressive';

export interface Weights {
  /** discount/weight on unrealized future hand potential vs realized rupees */
  hold: number;
  /** pull toward growing sets to 3/4/5-card bonus tiers */
  bonusChase: number;
  /** weight on opponent counter-play & market exposure */
  exposure: number;
  /** weight on camel exchange flexibility */
  camelFlex: number;
  /** multiplier on the 5K camel majority race */
  camelMajority: number;
  /** target comfortable hand size before crowding penalty kicks in */
  handComfort: number;
  /** preference multiplier for precious goods (diamond/gold/silver) */
  preciousPref: number;
  /** weight on contesting / racing opponent for scarce top tokens */
  competition: number;
  /** softmax sampling temperature over close top choices */
  temperature: number;
  /** minimum token sum (rupees) for a 1–2 card cheap sale unless endgame */
  smallSaleMin: number;
  /** extra penalty on flipping multiple unknown deck cards into opponent's lap */
  refillCaution: number;
  /** extra value on denying goods the opponent is visibly collecting */
  denial: number;
  /** willingness to close the round early when ahead */
  closeUrgency: number;
  /** bonus for keeping hand concentrated in fewer suits for big combos */
  focus: number;
  /** extra valuation when actually cashing in a 4+ or 5+ card bonus set */
  bigSaleDrive: number;
  /** patience against selling small (2-card or un-upgraded 3-card) sets early when uncontested */
  setPatience: number;
}

export const WEIGHTS: Record<Personality, Weights> = {
  cautious: {
    hold: 1.15,
    bonusChase: 0.88,
    exposure: 0.54,
    camelFlex: 1.58,
    camelMajority: 1.65,
    handComfort: 6,
    preciousPref: 1.05,
    competition: 1.46,
    temperature: 0.34,
    smallSaleMin: 5,
    refillCaution: 1.22,
    denial: 1.48,
    closeUrgency: 1.22,
    focus: 0.36,
    bigSaleDrive: 1.04,
    setPatience: 0.45,
  },
  balanced: {
    hold: 1.22,
    bonusChase: 1.44,
    exposure: 0.48,
    camelFlex: 1.18,
    camelMajority: 1.12,
    handComfort: 7,
    preciousPref: 1.12,
    competition: 1.32,
    temperature: 0.3,
    smallSaleMin: 9,
    refillCaution: 1.02,
    denial: 1.1,
    closeUrgency: 1.05,
    focus: 0.72,
    bigSaleDrive: 1.2,
    setPatience: 1.85,
  },
  aggressive: {
    hold: 1.24,
    bonusChase: 2.18,
    exposure: 0.48,
    camelFlex: 0.96,
    camelMajority: 0.82,
    handComfort: 7,
    preciousPref: 1.18,
    competition: 1.25,
    temperature: 0.24,
    smallSaleMin: Infinity,
    refillCaution: 0.94,
    denial: 1.08,
    closeUrgency: 1.08,
    focus: 1.54,
    bigSaleDrive: 1.64,
    setPatience: 4.7,
  },
};

const SETUP_DECK_SIZE = 40;
const GOOD_INDEX: Record<Good, number> = {
  diamond: 0,
  gold: 1,
  silver: 2,
  cloth: 3,
  spice: 4,
  leather: 5,
};
const IS_PRECIOUS = [true, true, true, false, false, false] as const;

export interface BoardContext {
  me: number;
  opp: number;
  myHand: number[];
  myHandSize: number;
  myHerd: number;
  oppHandSize: number;
  marketCounts: number[];
  marketCamels: number;
  discardCounts: number[];
  tokensTaken: number[];
  pileLens: number[];
  depletedPiles: number;
  deckCount: number;
  myScoreNow: number;
  oppScoreNow: number;
  myBonusCount: number;
  oppBonusCount: number;
  myGoodsCount: number;
  oppGoodsCount: number;
  oppHiddenBonuses: number;
  matchPointAgainstMe: boolean;
  belief: OpponentBelief;
  planGood: Good | null;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function buildBoardContext(
  view: PlayerView,
  me: number,
  belief: OpponentBelief,
  memory?: BotMemory,
): BoardContext {
  const opp = 1 - me;
  const selfP = view.players[me]!;
  const oppP = view.players[opp]!;

  const myHand = [0, 0, 0, 0, 0, 0];
  for (const c of selfP.hand ?? []) {
    if (c.type !== 'camel') myHand[GOOD_INDEX[c.type]]! += 1;
  }

  const marketCounts = [0, 0, 0, 0, 0, 0];
  let marketCamels = 0;
  for (const c of view.market) {
    if (c.type === 'camel') marketCamels += 1;
    else marketCounts[GOOD_INDEX[c.type]]! += 1;
  }

  const discardCounts = [0, 0, 0, 0, 0, 0];
  if (view.rules.discardBrowsable) {
    for (const c of view.discard) {
      if (c.type !== 'camel') discardCounts[GOOD_INDEX[c.type]]! += 1;
    }
  }

  const tokensTaken = [0, 0, 0, 0, 0, 0];
  const pileLens = [0, 0, 0, 0, 0, 0];
  let depletedPiles = 0;
  for (let i = 0; i < 6; i++) {
    const g = GOODS[i]!;
    const len = view.goodsPiles[g].length;
    pileLens[i] = len;
    tokensTaken[i] = TOKEN_VALUES[g].length - len;
    if (len === 0) depletedPiles += 1;
  }

  const myGoodsVal = selfP.goodsTokens.reduce((s, t) => s + t.value, 0);
  const oppGoodsVal = oppP.goodsTokens.reduce((s, t) => s + t.value, 0);
  let myBonusVal = 0;
  for (const b of selfP.bonusTokens) myBonusVal += b.value ?? TIER_MEAN[b.tier];
  let oppBonusVal = 0;
  let oppHiddenBonuses = 0;
  for (const b of oppP.bonusTokens) {
    if (b.value === null) oppHiddenBonuses += 1;
    oppBonusVal += b.value ?? TIER_MEAN[b.tier];
  }

  return {
    me,
    opp,
    myHand,
    myHandSize: selfP.handCount,
    myHerd: selfP.herdIds?.length ?? 0,
    oppHandSize: oppP.handCount,
    marketCounts,
    marketCamels,
    discardCounts,
    tokensTaken,
    pileLens,
    depletedPiles,
    deckCount: view.deckCount,
    myScoreNow: myGoodsVal + myBonusVal,
    oppScoreNow: oppGoodsVal + oppBonusVal,
    myBonusCount: selfP.bonusTokens.length,
    oppBonusCount: oppP.bonusTokens.length,
    myGoodsCount: selfP.goodsTokens.length,
    oppGoodsCount: oppP.goodsTokens.length,
    oppHiddenBonuses,
    matchPointAgainstMe: oppP.seals >= SEALS_TO_WIN - 1 && selfP.seals < oppP.seals,
    belief,
    planGood: memory?.planGood ?? null,
  };
}

/**
 * Smooth horizon in [0, 1] estimating how much of the round remains.
 * Combines deck depletion and total remaining tokens in the 3 smallest piles
 * (which starts at 5+5+5 = 15 and hits 0 when 3 piles are depleted).
 */
function roundHorizon(deckCount: number, pileLens: number[]): number {
  const deckFrac = Math.min(1, deckCount / SETUP_DECK_SIZE);
  const sorted = [...pileLens].sort((a, b) => a - b);
  const top3Sum = sorted[0]! + sorted[1]! + sorted[2]!;
  const pileFrac = Math.min(1, top3Sum / 12);
  return Math.min(deckFrac, pileFrac);
}

/**
 * Continuous expected token sum for selling `count` cards of `pile` when an
 * opponent is expected to take `shift` tokens ahead of us.
 */
function expectedPileYield(pile: Token[], count: number, shift: number): number {
  if (count <= 0 || pile.length === 0) return 0;
  const s = Math.max(0, Math.min(pile.length, shift));
  const lo = Math.floor(s);
  const hi = Math.ceil(s);
  const frac = s - lo;

  let sumLo = 0;
  const endLo = Math.min(pile.length, lo + count);
  for (let i = lo; i < endLo; i++) sumLo += pile[i]!.value;
  if (lo === hi) return sumLo;

  let sumHi = 0;
  const endHi = Math.min(pile.length, hi + count);
  for (let i = hi; i < endHi; i++) sumHi += pile[i]!.value;
  return sumLo * (1 - frac) + sumHi * frac;
}

function tierFor(count: number): BonusTier | null {
  if (count >= 5) return 5;
  if (count === 4) return 4;
  if (count === 3) return 3;
  return null;
}

function sellImmediateValue(
  piles: Record<Good, Token[]>,
  bonusCounts: Record<BonusTier, number>,
  good: Good,
  count: number,
): { total: number; tokenSum: number; gainedTokens: number; bonusTier: BonusTier | null } {
  const pile = piles[good];
  const n = Math.min(pile.length, count);
  let tokenSum = 0;
  for (let i = 0; i < n; i++) tokenSum += pile[i]!.value;
  const tier = tierFor(count);
  const gotBonus = tier !== null && bonusCounts[tier] > 0;
  return {
    total: tokenSum + (gotBonus ? TIER_MEAN[tier!] : 0),
    tokenSum,
    gainedTokens: n,
    bonusTier: gotBonus ? tier : null,
  };
}

export interface SimOutcome {
  hand: number[];
  handSize: number;
  herd: number;
  marketCounts: number[];
  marketCamels: number;
  deckAfter: number;
  unknownSlots: number;
  immediate: number;
  gainedTokenValue: number;
  gainedTokenCount: number;
  gainedBonusTier: BonusTier | null;
  endsRound: boolean;
  piles: Record<Good, Token[]>;
  pileLens: number[];
  depletedAfter: number;
  bonusCounts: Record<BonusTier, number>;
  soldGood: Good | null;
  soldCount: number;
  tookGoods: number[];
  gaveGoods: number[];
  gaveCamels: number;
}

export function simulateAction(view: PlayerView, ctx: BoardContext, action: Action): SimOutcome {
  const selfP = view.players[ctx.me]!;
  const hand = [...ctx.myHand];
  const marketCounts = [...ctx.marketCounts];
  const pileLens = [...ctx.pileLens];
  const tookGoods = [0, 0, 0, 0, 0, 0];
  const gaveGoods = [0, 0, 0, 0, 0, 0];

  const sim: SimOutcome = {
    hand,
    handSize: ctx.myHandSize,
    herd: ctx.myHerd,
    marketCounts,
    marketCamels: ctx.marketCamels,
    deckAfter: ctx.deckCount,
    unknownSlots: 0,
    immediate: 0,
    gainedTokenValue: 0,
    gainedTokenCount: 0,
    gainedBonusTier: null,
    endsRound: false,
    piles: view.goodsPiles,
    pileLens,
    depletedAfter: ctx.depletedPiles,
    bonusCounts: view.bonusPileCounts,
    soldGood: null,
    soldCount: 0,
    tookGoods,
    gaveGoods,
    gaveCamels: 0,
  };

  const deckEnds = (needed: number) =>
    view.rules.deckEndTrigger === 'deckEmpty'
      ? ctx.deckCount <= needed
      : ctx.deckCount < needed;

  switch (action.type) {
    case 'take': {
      const card = view.market.find((c) => c.id === action.cardId)!;
      const gi = GOOD_INDEX[card.type as Good];
      hand[gi]! += 1;
      tookGoods[gi]! += 1;
      marketCounts[gi]! -= 1;
      sim.handSize += 1;
      sim.unknownSlots = Math.min(1, ctx.deckCount);
      sim.deckAfter = Math.max(0, ctx.deckCount - 1);
      sim.endsRound = deckEnds(1);
      break;
    }
    case 'camels': {
      const n = ctx.marketCamels;
      sim.herd += n;
      sim.marketCamels = 0;
      sim.unknownSlots = Math.min(n, ctx.deckCount);
      sim.deckAfter = Math.max(0, ctx.deckCount - n);
      sim.endsRound = deckEnds(n);
      break;
    }
    case 'exchange': {
      const marketById = new Map<string, Card>();
      for (const c of view.market) marketById.set(c.id, c);
      const handById = new Map<string, Card>();
      for (const c of selfP.hand ?? []) handById.set(c.id, c);

      for (const id of action.take) {
        const c = marketById.get(id)!;
        if (c.type === 'camel') {
          sim.herd += 1;
          sim.marketCamels -= 1;
        } else {
          const gi = GOOD_INDEX[c.type];
          hand[gi]! += 1;
          tookGoods[gi]! += 1;
          marketCounts[gi]! -= 1;
          sim.handSize += 1;
        }
      }
      for (const id of action.give) {
        const c = handById.get(id);
        if (c && c.type !== 'camel') {
          const gi = GOOD_INDEX[c.type];
          hand[gi]! -= 1;
          gaveGoods[gi]! += 1;
          marketCounts[gi]! += 1;
          sim.handSize -= 1;
        } else {
          sim.herd -= 1;
          sim.gaveCamels += 1;
          sim.marketCamels += 1;
        }
      }
      sim.endsRound = ctx.deckCount === 0 && view.stallCount + 1 >= STALL_LIMIT;
      break;
    }
    case 'sell': {
      const handById = new Map<string, Card>();
      for (const c of selfP.hand ?? []) handById.set(c.id, c);
      const first = handById.get(action.cardIds[0]!)!;
      const good = first.type as Good;
      const gi = GOOD_INDEX[good];
      const count = action.cardIds.length;
      hand[gi]! -= count;
      sim.handSize -= count;
      sim.soldGood = good;
      sim.soldCount = count;

      const res = sellImmediateValue(view.goodsPiles, view.bonusPileCounts, good, count);
      sim.immediate = res.total;
      sim.gainedTokenValue = res.tokenSum;
      sim.gainedTokenCount = res.gainedTokens;
      sim.gainedBonusTier = res.bonusTier;

      const oldPile = view.goodsPiles[good];
      const newPile = oldPile.slice(res.gainedTokens);
      sim.piles = { ...view.goodsPiles, [good]: newPile };
      pileLens[gi] = newPile.length;
      if (oldPile.length > 0 && newPile.length === 0) sim.depletedAfter += 1;

      if (res.bonusTier !== null) {
        sim.bonusCounts = {
          ...view.bonusPileCounts,
          [res.bonusTier]: view.bonusPileCounts[res.bonusTier] - 1,
        };
      }
      sim.endsRound = sim.depletedAfter >= 3;
      break;
    }
  }
  return sim;
}

/**
 * Evaluate the realized-rupee-calibrated future potential of a hand.
 * Key DP invariant: a maxed set (5+ cards, or un-upgradeable set) never has
 * inflated hold value above its real sale value, while upgradeable sets
 * (2->3, 3->4, 4->5 when cards & time exist) carry genuine option value!
 */
function handPotential(
  ctx: BoardContext,
  hand: number[],
  handSize: number,
  marketCounts: number[],
  piles: Record<Good, Token[]>,
  pileLens: number[],
  bonusCounts: Record<BonusTier, number>,
  deckCount: number,
  w: Weights,
): number {
  const horizon = roundHorizon(deckCount, pileLens);
  let pot = 0;
  let distinctSuits = 0;

  for (let i = 0; i < 6; i++) {
    const c = hand[i]!;
    if (c <= 0) continue;
    distinctSuits += 1;
    const g = GOODS[i]!;
    const pile = piles[g];
    const precious = IS_PRECIOUS[i]!;
    const oppKnown = ctx.belief.knownHand[g];
    const oppExp = ctx.belief.expectedHand[g];
    const oppPressure = oppKnown * 0.85 + Math.max(0, oppExp - oppKnown) * 0.55;
    const shift = w.competition * oppPressure * (precious ? 1.0 : 0.65);

    let v = expectedPileYield(pile, c, shift);
    if (precious) v *= w.preciousPref;

    const availToMe =
      marketCounts[i]! + Math.max(0, ctx.belief.unseenGoods[g] - (oppExp - oppKnown));
    const canSeeMore = marketCounts[i]! >= 1;
    const reachFactor = canSeeMore
      ? 1.0
      : Math.min(0.75, availToMe / 3.2);

    if (c === 1) {
      if (precious) {
        if (availToMe < 0.35 || horizon < 0.08) v *= 0.08;
        else if (canSeeMore) v *= 0.64;
        else v *= 0.42 + 0.18 * Math.min(1, availToMe / 2.5);
      } else {
        const topVal = pile[0]?.value ?? 0;
        const seedFactor = horizon > 0.35 && availToMe >= 3 ? 0.28 : 0.16;
        v *= topVal >= 4 ? seedFactor + 0.08 : seedFactor;
      }
    } else if (c === 2) {
      if (precious) {
        // Only hold 2 precious for a 3rd if a 3rd copy is literally visible in the market & uncontested
        if (canSeeMore && horizon > 0.22 && bonusCounts[3] > 0 && oppKnown < 2) {
          v += Math.max(0, w.bonusChase - 0.85) * 3.8 * (0.45 + 0.55 * horizon);
        }
      } else {
        // Stepping stone toward 3-card or 4-card bonus on abundant cheap goods
        if (horizon > 0.16 && bonusCounts[3] > 0 && availToMe >= 0.9) {
          v += w.bonusChase * 2.05 * reachFactor * (0.45 + 0.55 * horizon);
        }
      }
    } else if (c === 3) {
      // Base realized tier-3 bonus
      if (bonusCounts[3] > 0) v += TIER_MEAN[3];
      // Upgrade option value: 3 -> 4 jumps bonus from 2K to 5K (+3K jump + extra token!)
      if (!precious && horizon > 0.18 && bonusCounts[4] > 0 && availToMe >= 0.9) {
        v += Math.max(0, w.bonusChase - 0.7) * 3.8 * reachFactor * (0.45 + 0.55 * horizon);
      } else if (precious && canSeeMore && horizon > 0.22 && bonusCounts[4] > 0) {
        v += Math.max(0, w.bonusChase - 0.95) * 3.5;
      }
    } else if (c === 4) {
      // Base realized tier-4 bonus
      if (bonusCounts[4] > 0) v += TIER_MEAN[4] * 0.96;
      // Upgrade 4 -> 5 (+4K bonus jump to 9K avg!)
      if (horizon > 0.2 && bonusCounts[5] > 0) {
        if (canSeeMore) {
          v += Math.max(0, w.bonusChase - 0.8) * 5.8 * (0.5 + 0.5 * horizon);
        } else if (!precious && availToMe >= 1.4 && w.bonusChase > 1.45) {
          v += (w.bonusChase - 1.4) * 5.2 * Math.min(1, availToMe / 3.0) * (0.4 + 0.6 * horizon);
        }
      }
    } else {
      // 5+ cards: ALREADY at max tier! Always cash in cleanly
      if (bonusCounts[5] > 0) v += TIER_MEAN[5] * 0.72;
    }

    pot += v;
  }

  // Hand concentration: fewer fragmented suits means higher combo efficiency
  if (handSize >= 3 && distinctSuits >= 2) {
    const avgStack = handSize / distinctSuits;
    pot += w.focus * (avgStack - 1.45) * (0.35 + 0.65 * horizon);
  }

  // Hand comfort & free-slot liquidity
  if (handSize > w.handComfort) {
    pot *= w.handComfort / handSize;
  }
  if (handSize === HAND_LIMIT && horizon > 0.2) {
    const hasStrongSale = GOODS.some((_g, i) => {
      const c = hand[i]!;
      return (IS_PRECIOUS[i] && c >= 2) || c >= 3;
    });
    pot -= hasStrongSale ? 0.35 : 2.1;
  } else if (handSize <= 5 && horizon > 0.25) {
    pot += 0.26 * (6 - handSize);
  }

  // Discount unsold hand as round end nears: unsold cards score 0
  const horizonDiscount = 0.3 + 0.7 * horizon;
  return pot * horizonDiscount;
}

/**
 * Value of holding `herd` camels: combines the late-locking 5K majority race
 * and mid-game exchange flexibility.
 */
function camelUtility(ctx: BoardContext, herd: number, horizon: number, w: Weights): number {
  const oppHerd = ctx.belief.oppHerdEst;
  const diff = herd - oppHerd;
  const phaseScale = 0.65 + 0.55 * (1 - horizon);
  const tieOffset = oppHerd > 0 ? 0.45 : 0.25;
  const majority = w.camelMajority * CAMEL_BONUS * phaseScale * sigmoid((diff - tieOffset) / 1.35);

  const flexRaw = Math.min(herd, 3) * 0.65 + Math.max(0, Math.min(herd - 3, 2)) * 0.3;
  const flex = w.camelFlex * flexRaw * (0.35 + 0.65 * horizon);
  return majority + flex;
}

/**
 * Exact endgame evaluation when `sim` immediately terminates the round.
 */
function evaluateRoundEnd(
  view: PlayerView,
  ctx: BoardContext,
  sim: SimOutcome,
  w: Weights,
): number {
  if (!sim.endsRound) return 0;
  const oppHerd = ctx.belief.oppHerdEst;
  let myCamel = 0;
  let oppCamel = 0;
  if (sim.herd > oppHerd) myCamel = CAMEL_BONUS;
  else if (oppHerd > sim.herd) oppCamel = CAMEL_BONUS;
  else if (view.rules.camelTie === 'all') {
    myCamel = CAMEL_BONUS;
    oppCamel = CAMEL_BONUS;
  }

  const myBonusGain = sim.gainedBonusTier ? TIER_MEAN[sim.gainedBonusTier] : 0;
  const myFinal = ctx.myScoreNow + sim.gainedTokenValue + myBonusGain + myCamel;
  const oppFinal = ctx.oppScoreNow + oppCamel;

  let margin = myFinal - oppFinal;
  if (Math.abs(margin) < 0.75) {
    const myB = ctx.myBonusCount + (sim.gainedBonusTier ? 1 : 0);
    const myG = ctx.myGoodsCount + sim.gainedTokenCount;
    if (myB !== ctx.oppBonusCount) margin += myB > ctx.oppBonusCount ? 0.6 : -0.6;
    else if (myG !== ctx.oppGoodsCount) margin += myG > ctx.oppGoodsCount ? 0.35 : -0.35;
  }

  const uncertainty = 1.6 + ctx.oppHiddenBonuses * 0.9;
  const winProb = sigmoid(margin / uncertainty);
  const stakes = ctx.matchPointAgainstMe ? 34 : 28;
  const closeShift = margin > 0 ? w.closeUrgency : 1 / Math.max(0.7, w.closeUrgency);
  return ((winProb - 0.5) * 2 * stakes + margin * 0.35) * closeShift;
}

/**
 * Fast 1-ply market exposure estimate used for initial ranking of all actions.
 */
function quickExposure(ctx: BoardContext, sim: SimOutcome, w: Weights): number {
  let bestOppTake = sim.marketCamels * 0.45;
  for (let i = 0; i < 6; i++) {
    const mc = sim.marketCounts[i]!;
    if (mc <= 0) continue;
    const g = GOODS[i]!;
    const top = sim.piles[g][0]?.value ?? 0;
    const known = ctx.belief.knownHand[g];
    const mult = mc >= 2 ? 1.8 : 1.0;
    const syn = known > 0 ? 1 + 0.35 * Math.min(known, 3) : 1;
    bestOppTake = Math.max(bestOppTake, top * mult * syn);
  }
  const oppCanTake = ctx.oppHandSize < HAND_LIMIT ? 1.0 : 0.42;
  const flipVal = sim.unknownSlots * 1.35 * w.refillCaution * oppCanTake;
  return bestOppTake * oppCanTake + flipVal;
}

/**
 * Deep 2-ply opponent counter-move + refill hazard + precious race evaluation.
 */
function evaluateOpponentCounter(
  view: PlayerView,
  ctx: BoardContext,
  sim: SimOutcome,
  w: Weights,
): number {
  if (sim.endsRound) return 0;

  const oppHand = ctx.oppHandSize;
  const oppHerd = ctx.belief.oppHerdEst;
  const oppCanTake = oppHand < HAND_LIMIT;
  const horizonAfter = roundHorizon(sim.deckAfter, sim.pileLens);

  // 1. Opponent's best immediate visible market action
  let bestMarketGain = 0;

  if (oppCanTake) {
    for (let i = 0; i < 6; i++) {
      if (sim.marketCounts[i]! <= 0) continue;
      const g = GOODS[i]!;
      const top = sim.piles[g][0]?.value ?? 0;
      const known = ctx.belief.knownHand[g];
      const recent = ctx.belief.recentInterest[g];
      let val = top * (IS_PRECIOUS[i] ? 1.05 : 0.72);
      if (known >= 1) {
        if (IS_PRECIOUS[i]) {
          val += top * (known === 1 ? 0.95 : 0.65);
        } else {
          const nextCnt = known + 1;
          val += nextCnt >= 3 ? TIER_MEAN[tierFor(nextCnt)!] * 0.7 : 1.3;
        }
      } else if (recent > 0) {
        val += 1.2 * recent;
      }
      bestMarketGain = Math.max(bestMarketGain, val);
    }
  }

  // Opponent multi-card exchange sweep
  const maxSweepByHandLimit =
    oppHerd > 0
      ? Math.min(5, Math.max(0, HAND_LIMIT - oppHand) + Math.max(0, oppHand - 2))
      : Math.min(5, oppHand);
  const oppSweepCap = Math.min(maxSweepByHandLimit, oppHerd + Math.max(0, oppHand - 2));

  if (oppSweepCap >= 2) {
    const marketCardVals: number[] = [];
    for (let i = 0; i < 6; i++) {
      const mc = sim.marketCounts[i]!;
      if (mc <= 0) continue;
      const g = GOODS[i]!;
      const pile = sim.piles[g];
      const known = ctx.belief.knownHand[g];
      for (let k = 0; k < mc; k++) {
        const tokVal = pile[Math.min(k, Math.max(0, pile.length - 1))]?.value ?? 0;
        let v = tokVal * (IS_PRECIOUS[i] ? 0.92 : 0.58);
        if (known + k >= 1 && IS_PRECIOUS[i]) v += 1.6;
        if (known + k >= 2 && !IS_PRECIOUS[i]) v += 1.5;
        marketCardVals.push(v);
      }
    }
    if (marketCardVals.length >= 2) {
      marketCardVals.sort((a, b) => b - a);
      const takeN = Math.min(oppSweepCap, marketCardVals.length, 4);
      let bundle = 0;
      for (let k = 0; k < takeN; k++) bundle += marketCardVals[k]!;
      const giveCost = takeN <= oppHerd ? takeN * 0.75 : oppHerd * 0.75 + (takeN - oppHerd) * 1.65;
      bestMarketGain = Math.max(bestMarketGain, Math.max(0, bundle - giveCost));
    }
  }

  if (sim.marketCamels >= 2) {
    const camelThreat =
      sim.marketCamels * 0.75 + (oppHerd + sim.marketCamels > sim.herd ? 2.0 : 0.4);
    bestMarketGain = Math.max(bestMarketGain, camelThreat);
  }

  // 2. Deck-flip hazard (Camel Trap awareness)
  let refillRisk = 0;
  if (sim.unknownSlots > 0 && ctx.deckCount > 0) {
    let evPerFlip = 0;
    for (let i = 0; i < 6; i++) {
      const g = GOODS[i]!;
      const p = ctx.belief.deckProb[g];
      if (p <= 0) continue;
      const top = sim.piles[g][0]?.value ?? 0;
      const known = ctx.belief.knownHand[g];
      const val = top * (IS_PRECIOUS[i] ? 1.15 : 0.68) + (known >= 1 ? 1.8 : 0);
      evPerFlip += p * val;
    }
    const u = sim.unknownSlots;
    const oppExploitFactor =
      oppHand <= 4
        ? 1.15
        : oppHand <= 5
          ? 1.0
          : oppHand === 6
            ? 0.85
            : oppHerd >= 2
              ? 0.65
              : 0.32;
    const multiFlipFactor = u === 1 ? 0.95 : 1.05 + (u - 1) * 0.78;
    refillRisk = evPerFlip * multiFlipFactor * oppExploitFactor * w.refillCaution;
  }

  // 3. Precious / Contested Pile Race Risk (concrete imminent opponent sell threats only)
  let raceRisk = 0;
  for (let i = 0; i < 6; i++) {
    const myCnt = sim.hand[i]!;
    if (myCnt < 2) continue;
    const g = GOODS[i]!;
    const pile = sim.piles[g];
    if (pile.length === 0) continue;

    const known = ctx.belief.knownHand[g];
    const exp = ctx.belief.expectedHand[g];
    const minSell = IS_PRECIOUS[i] ? 2 : 3;

    let oppSellProb = 0;
    if (known >= minSell) oppSellProb = 0.75;
    else if (known >= 1 && IS_PRECIOUS[i] && exp >= 1.55) oppSellProb = 0.36;
    else if (oppHand >= HAND_LIMIT - 1 && exp >= minSell) oppSellProb = 0.28;

    if (oppHand >= HAND_LIMIT) oppSellProb = Math.min(0.9, oppSellProb * 1.35);
    if (horizonAfter < 0.25) oppSellProb = Math.min(0.9, oppSellProb * 1.25);

    if (oppSellProb > 0.05) {
      const oppSellSize = Math.max(minSell, Math.round(Math.max(known, exp)));
      const nowYield = expectedPileYield(pile, myCnt, 0);
      const afterOppYield = expectedPileYield(pile, myCnt, oppSellSize);
      const tokenDrop = Math.max(0, nowYield - afterOppYield);
      const myTier = tierFor(myCnt);
      const bonusLoss =
        myTier && sim.bonusCounts[myTier] === 1 && oppSellSize >= myTier
          ? TIER_MEAN[myTier] * 0.5
          : 0;
      raceRisk += oppSellProb * (tokenDrop + bonusLoss) * 0.6 * (w.competition / 1.35);
    }
  }

  // 4. Opponent Endgame Ambush Risk (only when OUR action newly exposes a closing line)
  let ambushRisk = 0;
  const myCamelLead = sim.herd > oppHerd ? CAMEL_BONUS : oppHerd > sim.herd ? -CAMEL_BONUS : 0;
  const scoreLeadAfter =
    ctx.myScoreNow +
    sim.gainedTokenValue +
    (sim.gainedBonusTier ? TIER_MEAN[sim.gainedBonusTier] : 0) -
    ctx.oppScoreNow +
    myCamelLead;

  const worsenedEndThreat =
    sim.deckAfter < ctx.deckCount ||
    sim.marketCamels > ctx.marketCamels ||
    sim.depletedAfter > ctx.depletedPiles;

  if (worsenedEndThreat && scoreLeadAfter < -1) {
    const oneTakeEnds =
      view.rules.deckEndTrigger === 'deckEmpty' ? sim.deckAfter <= 1 : sim.deckAfter === 0;
    const camelsEnd =
      sim.marketCamels > 0 &&
      (view.rules.deckEndTrigger === 'deckEmpty'
        ? sim.deckAfter <= sim.marketCamels
        : sim.deckAfter < sim.marketCamels);
    const thirdPileFragile =
      sim.depletedAfter >= 2 &&
      GOODS.some(
        (g, i) =>
          sim.pileLens[i]! > 0 && sim.pileLens[i]! <= Math.max(2, ctx.belief.knownHand[g] + 1),
      );

    if (oneTakeEnds || camelsEnd || thirdPileFragile) {
      const trappedValue = Math.min(18, sim.handSize * 2.4);
      ambushRisk = (5.5 + trappedValue * 0.4) * (ctx.matchPointAgainstMe ? 1.3 : 1.0);
    }
  }

  return bestMarketGain * w.exposure + refillRisk * w.exposure + raceRisk + ambushRisk;
}

/**
 * Denial bonus when snatching a card the opponent visibly wants (or penalty for dumping it).
 */
function denialBonus(ctx: BoardContext, sim: SimOutcome, w: Weights): number {
  let bonus = 0;
  for (let i = 0; i < 6; i++) {
    const took = sim.tookGoods[i]!;
    if (took <= 0) continue;
    const g = GOODS[i]!;
    const known = ctx.belief.knownHand[g];
    const recent = ctx.belief.recentInterest[g];
    if (known >= 1 || recent > 0) {
      const top = sim.piles[g][0]?.value ?? 0;
      const threat = IS_PRECIOUS[i] ? 1.15 : 0.65;
      bonus += took * (known * 0.8 + recent * 0.6) * Math.max(1, top * 0.25) * threat;
    }
  }
  for (let i = 0; i < 6; i++) {
    const gave = sim.gaveGoods[i]!;
    if (gave <= 0) continue;
    const g = GOODS[i]!;
    const known = ctx.belief.knownHand[g];
    const recent = ctx.belief.recentInterest[g];
    if (known >= 1 || recent > 0) {
      const top = sim.piles[g][0]?.value ?? 0;
      bonus -= gave * (known * 1.1 + recent * 0.7) * Math.max(1.2, top * 0.35);
    }
  }
  return bonus * w.denial;
}

/**
 * Personality-adjusted immediate sale payoff:
 * - Rewards landing 4/5-card bonus sets for combo-focused styles.
 * - Applies early/mid-round patience against premature 2-card (or un-upgraded 3-card cheap)
 *   sales when the good is not urgently contested and the round isn't closing.
 */
function immediatePayoff(ctx: BoardContext, sim: SimOutcome, w: Weights, horizon: number): number {
  if (sim.soldGood === null) return 0;
  let pay = sim.immediate;
  if (sim.soldCount >= 5 && sim.gainedBonusTier) {
    pay = sim.gainedTokenValue + TIER_MEAN[sim.gainedBonusTier] * (w.bigSaleDrive * 1.15);
  } else if (sim.soldCount === 4 && sim.gainedBonusTier) {
    pay = sim.gainedTokenValue + TIER_MEAN[sim.gainedBonusTier] * (1 + (w.bigSaleDrive - 1) * 0.65);
  }
  if (!sim.endsRound && w.setPatience > 0 && horizon > 0.2) {
    const gi = GOOD_INDEX[sim.soldGood];
    const oppKnown = ctx.belief.knownHand[sim.soldGood];
    const contested = oppKnown >= (IS_PRECIOUS[gi] ? 2 : 3);
    const moreAvail =
      ctx.marketCounts[gi]! +
      Math.max(0, ctx.belief.unseenGoods[sim.soldGood] - (ctx.belief.expectedHand[sim.soldGood] - oppKnown));

    if (!contested && moreAvail >= 0.8) {
      if (sim.soldCount <= 2) {
        const jamScale = ctx.myHandSize >= HAND_LIMIT ? 0.45 : 1.0;
        // Let aggressive cash prime 2-card precious pairs when needed, but hold cheap pairs for combos
        const typeScale = IS_PRECIOUS[gi] ? 0.56 : 1.3;
        pay -= w.setPatience * typeScale * (0.35 + 0.65 * horizon) * jamScale;
      } else if (sim.soldCount === 3 && !IS_PRECIOUS[gi] && sim.bonusCounts[4] > 0 && moreAvail >= 1.5) {
        const jamScale = ctx.myHandSize >= HAND_LIMIT ? 0.35 : 1.0;
        pay -= Math.max(0, w.setPatience - 1.1) * 0.95 * (0.35 + 0.65 * horizon) * jamScale;
      }
    }
  }
  return pay;
}

/** Small tempo cost on exchanges so bots don't do marginal lateral shuffles or stall loops. */
function exchangeFriction(view: PlayerView, sim: SimOutcome): number {
  const isExchange = sim.tookGoods.some((n) => n > 0) && (sim.gaveGoods.some((n) => n > 0) || sim.gaveCamels > 0);
  if (!isExchange) return 0;
  const prevWasExchange = view.lastEvents.some((e) => e.type === 'exchange');
  let cost = 0.45 + (prevWasExchange ? 0.55 : 0);
  if (view.turn > 55) cost += Math.min(8, (view.turn - 55) * 0.12);
  return cost;
}

export function scoreAction1Ply(
  view: PlayerView,
  ctx: BoardContext,
  action: Action,
  w: Weights,
  potBefore: number,
  camelBefore: number,
): { score: number; sim: SimOutcome } {
  const sim = simulateAction(view, ctx, action);
  const horizonAfter = roundHorizon(sim.deckAfter, sim.pileLens);
  const potAfter = handPotential(
    ctx,
    sim.hand,
    sim.handSize,
    sim.marketCounts,
    sim.piles,
    sim.pileLens,
    sim.bonusCounts,
    sim.deckAfter,
    w,
  );
  const camelAfter = camelUtility(ctx, sim.herd, horizonAfter, w);
  const dCamel = camelAfter - camelBefore;
  const exp = quickExposure(ctx, sim, w);
  const end = evaluateRoundEnd(view, ctx, sim, w);
  const deny = denialBonus(ctx, sim, w);
  const planNudge =
    ctx.planGood && sim.tookGoods[GOOD_INDEX[ctx.planGood]]! > 0 ? 0.3 : 0;

  const score =
    immediatePayoff(ctx, sim, w, horizonAfter) +
    w.hold * (potAfter - potBefore) -
    w.exposure * exp +
    dCamel +
    end +
    deny +
    planNudge -
    exchangeFriction(view, sim);
  return { score, sim };
}

export function scoreAction2Ply(
  view: PlayerView,
  ctx: BoardContext,
  sim: SimOutcome,
  w: Weights,
  potBefore: number,
  camelBefore: number,
): number {
  const horizonAfter = roundHorizon(sim.deckAfter, sim.pileLens);
  const potAfter = handPotential(
    ctx,
    sim.hand,
    sim.handSize,
    sim.marketCounts,
    sim.piles,
    sim.pileLens,
    sim.bonusCounts,
    sim.deckAfter,
    w,
  );
  const camelAfter = camelUtility(ctx, sim.herd, horizonAfter, w);
  const dCamel = camelAfter - camelBefore;
  const oppCounter = evaluateOpponentCounter(view, ctx, sim, w);
  const end = evaluateRoundEnd(view, ctx, sim, w);
  const deny = denialBonus(ctx, sim, w);
  const planNudge =
    ctx.planGood && sim.tookGoods[GOOD_INDEX[ctx.planGood]]! > 0 ? 0.35 : 0;

  return (
    immediatePayoff(ctx, sim, w, horizonAfter) +
    w.hold * (potAfter - potBefore) -
    oppCounter +
    dCamel +
    end +
    deny +
    planNudge -
    exchangeFriction(view, sim)
  );
}

export function baseStateValues(
  view: PlayerView,
  ctx: BoardContext,
  w: Weights,
): { potBefore: number; camelBefore: number; horizonBefore: number } {
  const horizonBefore = roundHorizon(ctx.deckCount, ctx.pileLens);
  const potBefore = handPotential(
    ctx,
    ctx.myHand,
    ctx.myHandSize,
    ctx.marketCounts,
    view.goodsPiles,
    ctx.pileLens,
    view.bonusPileCounts,
    ctx.deckCount,
    w,
  );
  const camelBefore = camelUtility(ctx, ctx.myHerd, horizonBefore, w);
  return { potBefore, camelBefore, horizonBefore };
}

/** Infer which good the bot is currently building toward (for soft multi-turn coherence). */
export function inferPlanGood(sim: SimOutcome): Good | null {
  let bestGood: Good | null = null;
  let bestWeight = 0;
  for (let i = 0; i < 6; i++) {
    const c = sim.hand[i]!;
    if (c < 2) continue;
    const g = GOODS[i]!;
    const top = sim.piles[g][0]?.value ?? 0;
    const weight = c * (IS_PRECIOUS[i] ? 1.5 : 1.0) + top * 0.25;
    if (weight > bestWeight) {
      bestWeight = weight;
      bestGood = g;
    }
  }
  return bestGood;
}
