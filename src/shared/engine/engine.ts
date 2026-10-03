import { checkAction } from './actions';
import {
  BONUS_TIERS,
  BONUS_VALUES,
  CAMEL_BONUS,
  CARD_COUNTS,
  CAMEL_CARD_COUNT,
  GOODS,
  INITIAL_DEAL,
  MARKET_CAMELS,
  MARKET_REFILL_SETUP,
  MARKET_SIZE,
  MAX_ROUNDS,
  PLAYER_COUNT,
  PRECIOUS,
  SEALS_TO_WIN,
  STALL_LIMIT,
  TOKEN_VALUES,
} from './constants';
import { expandSeed, sfc32Next } from './prng';
import { DEFAULT_RULES } from './rules';
import type {
  Action,
  ActionContext,
  BonusTier,
  BonusToken,
  Card,
  CardType,
  GameEvent,
  GameState,
  Good,
  PlayerState,
  RoundEndReason,
  RoundPlayerResult,
  RoundResult,
  Token,
} from './types';

export class IllegalActionError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'IllegalActionError';
    this.reason = reason;
  }
}

/* ---------- rng helpers operating on a draft state ---------- */

function rand(s: GameState): number {
  const [v, next] = sfc32Next(s.rng);
  s.rng = next;
  return v;
}

function randInt(s: GameState, n: number): number {
  return Math.floor(rand(s) * n);
}

function shuffle<T>(s: GameState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function idRand(s: GameState): number {
  const [v, next] = sfc32Next(s.idRng);
  s.idRng = next;
  return v;
}

/**
 * Random opaque id from the dedicated id stream — never derived from card
 * type, bonus value or position, and independent of the game stream.
 */
function rid(s: GameState): string {
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += ID_ALPHABET[Math.floor(idRand(s) * ID_ALPHABET.length)];
  }
  return out;
}

/* ---------- setup ---------- */

function freshPlayers(): PlayerState[] {
  return Array.from({ length: PLAYER_COUNT }, () => ({
    hand: [],
    herd: [],
    goodsTokens: [],
    bonusTokens: [],
    seals: 0,
    matchRupees: 0,
  }));
}

function buildGoodsPiles(): Record<Good, Token[]> {
  const piles = {} as Record<Good, Token[]>;
  for (const g of GOODS) {
    piles[g] = TOKEN_VALUES[g].map((value, i) => ({ id: `${g}-${i}`, good: g, value }));
  }
  return piles;
}

function buildBonusPiles(s: GameState): Record<BonusTier, BonusToken[]> {
  const piles = {} as Record<BonusTier, BonusToken[]>;
  for (const t of BONUS_TIERS) {
    piles[t] = shuffle(s, [...BONUS_VALUES[t]]).map((value) => ({ id: rid(s), tier: t, value }));
  }
  return piles;
}

/**
 * Fresh deal for one round (RULES §3): 3 camels to market, shuffle the
 * remaining 52, 5 each, 2 more to market, hand camels move to herds.
 * Card ids are drawn from the PRNG after shuffling.
 */
function dealRound(s: GameState): void {
  const types: CardType[] = [];
  for (const g of GOODS) for (let i = 0; i < CARD_COUNTS[g]; i++) types.push(g);
  for (let i = 0; i < CAMEL_CARD_COUNT - MARKET_CAMELS; i++) types.push('camel');

  const shuffled = shuffle(s, types); // 52 types
  const cards: Card[] = shuffled.map((type) => ({ id: rid(s), type }));
  const marketCamels: Card[] = Array.from({ length: MARKET_CAMELS }, () => ({
    id: rid(s),
    type: 'camel' as const,
  }));

  const market: Card[] = [...marketCamels];
  for (const p of s.players) {
    p.hand = cards.splice(0, INITIAL_DEAL);
  }
  market.push(...cards.splice(0, MARKET_REFILL_SETUP));
  for (const p of s.players) {
    const camels = p.hand.filter((c) => c.type === 'camel');
    p.hand = p.hand.filter((c) => c.type !== 'camel');
    p.herd = camels;
    p.goodsTokens = [];
    p.bonusTokens = [];
  }
  s.market = market;
  s.deck = cards;
  s.discard = [];
  s.goodsPiles = buildGoodsPiles();
  s.bonusPiles = buildBonusPiles(s);
  s.stallCount = 0;
}

export function createMatch(opts: {
  seed: number | number[];
  rules?: Partial<import('./rules').RuleOptions>;
  starter?: number;
}): GameState {
  const { rng, idRng } = expandSeed(opts.seed);
  const state: GameState = {
    rules: { ...DEFAULT_RULES, ...(opts.rules ?? {}) },
    rng,
    idRng,
    players: freshPlayers(),
    deck: [],
    market: [],
    discard: [],
    goodsPiles: buildGoodsPiles(),
    bonusPiles: { 3: [], 4: [], 5: [] },
    round: 1,
    starter: 0,
    current: 0,
    turn: 0,
    phase: 'playing',
    stallCount: 0,
    roundResults: [],
    lastEvents: [],
    matchWinners: null,
  };
  const starter = opts.starter ?? randInt(state, PLAYER_COUNT);
  state.starter = starter;
  state.current = starter;
  dealRound(state);
  state.lastEvents = [{ type: 'roundStart', round: 1, starter }];
  return state;
}

/* ---------- market slot helper ---------- */

/**
 * Rebuilds the market: each vacated slot index receives the next fill card,
 * or vanishes if no fill remains. Non-vacated slots keep their cards.
 */
function refillSlots(market: Card[], vacated: number[], fills: Card[]): Card[] {
  const vac = new Set(vacated);
  const out: Card[] = [];
  let f = 0;
  for (let i = 0; i < market.length; i++) {
    if (vac.has(i)) {
      if (f < fills.length) out.push(fills[f++]!);
    } else {
      out.push(market[i]!);
    }
  }
  return out;
}

/* ---------- action application ---------- */

export function actionContextFor(state: GameState, player: number): ActionContext {
  const p = state.players[player];
  if (!p) throw new IllegalActionError('玩家不存在');
  return {
    rules: state.rules,
    market: state.market,
    hand: p.hand,
    herd: p.herd,
    goodsPiles: state.goodsPiles,
    deckCount: state.deck.length,
  };
}

export function applyAction(state: GameState, player: number, action: Action): GameState {
  if (state.phase === 'roundOver') throw new IllegalActionError('本轮已结束，请进入下一轮');
  if (state.phase === 'matchOver') throw new IllegalActionError('整场已结束');
  if (player < 0 || player >= PLAYER_COUNT || player !== state.current) {
    throw new IllegalActionError('还没轮到你行动');
  }
  const chk = checkAction(actionContextFor(state, player), action);
  if (!chk.ok) throw new IllegalActionError(chk.reason);

  const s = structuredClone(state);
  const p = s.players[player]!;
  const events: GameEvent[] = [];
  let refillFailed = false;

  switch (action.type) {
    case 'take': {
      const idx = s.market.findIndex((c) => c.id === action.cardId);
      const card = s.market[idx]!;
      const drawn = s.deck.splice(0, 1);
      s.market = refillSlots(s.market, [idx], drawn);
      p.hand.push(card);
      refillFailed = drawn.length < 1;
      events.push({ type: 'take', player, card, refill: drawn });
      break;
    }
    case 'camels': {
      const idxs: number[] = [];
      const cards: Card[] = [];
      s.market.forEach((c, i) => {
        if (c.type === 'camel') {
          idxs.push(i);
          cards.push(c);
        }
      });
      const drawn = s.deck.splice(0, idxs.length);
      s.market = refillSlots(s.market, idxs, drawn);
      p.herd.push(...cards);
      refillFailed = drawn.length < idxs.length;
      events.push({ type: 'camels', player, cards, refill: drawn });
      break;
    }
    case 'exchange': {
      const takenIdxs = action.take.map((id) => s.market.findIndex((c) => c.id === id));
      const taken = takenIdxs.map((i) => s.market[i]!);
      const given: Card[] = [];
      for (const id of action.give) {
        let i = p.hand.findIndex((c) => c.id === id);
        if (i >= 0) {
          given.push(p.hand.splice(i, 1)[0]!);
        } else {
          i = p.herd.findIndex((c) => c.id === id);
          given.push(p.herd.splice(i, 1)[0]!);
        }
      }
      for (const c of taken) {
        if (c.type === 'camel') p.herd.push(c);
        else p.hand.push(c);
      }
      s.market = refillSlots(s.market, takenIdxs, given);
      events.push({ type: 'exchange', player, took: taken, gave: given });
      break;
    }
    case 'sell': {
      const sold: Card[] = [];
      for (const id of action.cardIds) {
        const i = p.hand.findIndex((c) => c.id === id);
        sold.push(p.hand.splice(i, 1)[0]!);
      }
      s.discard.push(...sold);
      const good = sold[0]!.type as Good;
      const pile = s.goodsPiles[good];
      const tokens = pile.splice(0, Math.min(sold.length, pile.length));
      p.goodsTokens.push(...tokens);
      const tier: BonusTier | null =
        sold.length >= 5 ? 5 : sold.length === 4 ? 4 : sold.length === 3 ? 3 : null;
      let bonus: BonusToken | null = null;
      if (tier !== null && s.bonusPiles[tier].length > 0) {
        bonus = s.bonusPiles[tier].shift()!;
        p.bonusTokens.push(bonus);
      }
      events.push({
        type: 'sell',
        player,
        good,
        cards: sold,
        tokens,
        bonus: bonus ? { id: bonus.id, tier: bonus.tier, value: bonus.value } : null,
      });
      break;
    }
  }

  s.turn += 1;

  // round-end checks (RULES §6), evaluated after the action settles
  let reason: RoundEndReason | null = null;
  if (action.type === 'sell' && GOODS.filter((g) => s.goodsPiles[g].length === 0).length >= 3) {
    reason = 'tokens';
  } else if (
    refillFailed ||
    (s.rules.deckEndTrigger === 'deckEmpty' && s.deck.length === 0)
  ) {
    reason = 'deck';
  }
  if (s.deck.length === 0) {
    s.stallCount = action.type === 'exchange' ? s.stallCount + 1 : 0;
    if (reason === null && s.stallCount >= STALL_LIMIT) reason = 'stall';
  } else {
    s.stallCount = 0;
  }

  if (reason !== null) {
    const result = scoreRound(s, reason);
    s.roundResults.push(result);
    result.perPlayer.forEach((r, i) => {
      s.players[i]!.matchRupees += r.total;
    });
    for (const w of result.sealWinners) s.players[w]!.seals += 1;
    events.push({ type: 'roundEnd', reason, result });
    finishOrContinue(s, events);
  }

  s.lastEvents = events;
  s.current = (player + 1) % PLAYER_COUNT;
  return s;
}

/* ---------- scoring & match end ---------- */

function scoreRound(s: GameState, reason: RoundEndReason): RoundResult {
  const herds = s.players.map((p) => p.herd.length);
  const maxHerd = Math.max(...herds);
  const herdLeaders = herds.map((h, i) => (h === maxHerd ? i : -1)).filter((i) => i >= 0);

  const perPlayer: RoundPlayerResult[] = s.players.map((p, i) => {
    const goods = p.goodsTokens.reduce((a, t) => a + t.value, 0);
    const bonus = p.bonusTokens.reduce((a, t) => a + t.value, 0);
    let camel = 0;
    if (herdLeaders.length === 1 && herdLeaders[0] === i) camel = CAMEL_BONUS;
    else if (herdLeaders.length > 1 && herdLeaders.includes(i) && s.rules.camelTie === 'all') {
      camel = CAMEL_BONUS;
    }
    return {
      goods,
      bonus,
      camel,
      total: goods + bonus + camel,
      bonusCount: p.bonusTokens.length,
      goodsCount: p.goodsTokens.length,
      herd: herds[i]!,
      bonusValues: p.bonusTokens.map((t) => t.value),
    };
  });

  const best = Math.max(...perPlayer.map((r) => tripleKey(r)));
  const topTied = perPlayer
    .map((r, i) => (tripleKey(r) === best ? i : -1))
    .filter((i) => i >= 0);
  const sealWinners =
    topTied.length === 1 ? topTied : s.rules.sealTie === 'all' ? topTied : [];

  return { round: s.round, reason, sealWinners, perPlayer };
}

/** Order triples as a single sortable number (totals are small enough). */
function tripleKey(r: Pick<RoundPlayerResult, 'total' | 'bonusCount' | 'goodsCount'>): number {
  return r.total * 1e6 + r.bonusCount * 1e3 + r.goodsCount;
}

function determineWinners(s: GameState): number[] {
  let best: PlayerState[] = [];
  let bestIdx: number[] = [];
  s.players.forEach((p, i) => {
    if (bestIdx.length === 0) {
      best = [p];
      bestIdx = [i];
      return;
    }
    const b = best[0]!;
    if (p.seals > b.seals || (p.seals === b.seals && p.matchRupees > b.matchRupees)) {
      best = [p];
      bestIdx = [i];
    } else if (p.seals === b.seals && p.matchRupees === b.matchRupees) {
      bestIdx.push(i);
    }
  });
  return bestIdx;
}

function finishOrContinue(s: GameState, events: GameEvent[]): void {
  const maxSeals = Math.max(...s.players.map((p) => p.seals));
  const over =
    s.rules.matchLength === 'single' || maxSeals >= SEALS_TO_WIN || s.round >= MAX_ROUNDS;
  if (over) {
    s.phase = 'matchOver';
    s.matchWinners = determineWinners(s);
    events.push({ type: 'matchEnd', winners: s.matchWinners });
  } else {
    s.phase = 'roundOver';
  }
}

export function nextRound(state: GameState): GameState {
  if (state.phase !== 'roundOver') {
    throw new IllegalActionError('本轮还没结束，不能进入下一轮');
  }
  const s = structuredClone(state);
  const prevStarter = s.starter;

  let starter: number;
  if (s.rules.nextRoundStarter === 'rotate') {
    starter = (prevStarter + 1) % PLAYER_COUNT;
  } else {
    // loser: the player who did not get the seal. With no unique loser
    // (full tie under sealTie=none, or both sealed under sealTie=all),
    // the player who went second last round starts.
    const res = s.roundResults[s.roundResults.length - 1]!;
    starter =
      res.sealWinners.length === 1
        ? 1 - res.sealWinners[0]!
        : (prevStarter + 1) % PLAYER_COUNT;
  }

  s.round += 1;
  s.starter = starter;
  s.current = starter;
  // bump the state version so a stale act from the ended round can't
  // pass the server's turn check against the new round
  s.turn += 1;
  dealRound(s);
  s.phase = 'playing';
  s.lastEvents = [{ type: 'roundStart', round: s.round, starter }];
  return s;
}
