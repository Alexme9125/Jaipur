import { CAMEL_CARD_COUNT, CARD_COUNTS, GOODS, INITIAL_DEAL, TOKEN_VALUES } from '../engine/constants';
import type { CardType, Good } from '../engine/types';
import type { PlayerView } from '../engine/view';

/**
 * Pure public-information memory for a bot seat.
 * Only consumes redacted PlayerView snapshots (never sees deck or opponent's
 * hidden initial cards), mirroring what an attentive human player tracks
 * across turns and rounds. Plain JSON-serializable.
 */
export interface BotMemory {
  round: number;
  lastTurn: number;
  /** Publicly seen cardId -> CardType within the current round */
  knownCards: Record<string, CardType>;
  /** Goods the opponent visibly acquired in recent turns (most recent last) */
  oppRecentGoods: Good[];
  /** Tracked opponent herd count when camelCountPublic is disabled */
  trackedOppHerd: number | null;
  /** Soft tactical focus from the bot's own previous turn (prevents flip-flopping) */
  planGood: Good | null;
  /** Match-level adaptation signals about opponent's play tendencies */
  oppProfile: {
    sells: number;
    bigSells: number;
    smallCheapSells: number;
    camelTakes: number;
    exchanges: number;
  };
}

export function createBotMemory(): BotMemory {
  return {
    round: 0,
    lastTurn: -1,
    knownCards: {},
    oppRecentGoods: [],
    trackedOppHerd: null,
    planGood: null,
    oppProfile: {
      sells: 0,
      bigSells: 0,
      smallCheapSells: 0,
      camelTakes: 0,
      exchanges: 0,
    },
  };
}

function resetRound(mem: BotMemory, view: PlayerView, oppSeat: number): void {
  mem.round = view.round;
  mem.lastTurn = -1;
  mem.knownCards = {};
  mem.oppRecentGoods = [];
  mem.planGood = null;
  const opp = view.players[oppSeat]!;
  if (opp.herdCount !== null) {
    mem.trackedOppHerd = opp.herdCount;
  } else if (view.lastEvents.some((e) => e.type === 'roundStart')) {
    // At round start each player receives 5 cards; non-hand cards are camels in herd.
    mem.trackedOppHerd = Math.max(0, INITIAL_DEAL - opp.handCount);
  } else {
    mem.trackedOppHerd = opp.hasCamels ? 1 : 0;
  }
}

/**
 * Observe a new PlayerView snapshot and update public-information tracking.
 * Safe to call repeatedly on the same turn (idempotent on round+turn).
 */
export function observeBotMemory(mem: BotMemory, view: PlayerView, seat: number): void {
  const oppSeat = 1 - seat;
  if (view.round !== mem.round || view.turn < mem.lastTurn) {
    resetRound(mem, view, oppSeat);
  }
  if (view.turn === mem.lastTurn) return;
  mem.lastTurn = view.turn;

  const remember = (id: string, type: CardType) => {
    mem.knownCards[id] = type;
  };

  for (const c of view.market) remember(c.id, c.type);
  for (const c of view.discard) remember(c.id, c.type);
  for (const c of view.players[seat]?.hand ?? []) remember(c.id, c.type);

  for (const e of view.lastEvents) {
    switch (e.type) {
      case 'take':
        remember(e.card.id, e.card.type);
        for (const r of e.refill) remember(r.id, r.type);
        if (e.player === oppSeat && e.card.type !== 'camel') {
          mem.oppRecentGoods.push(e.card.type);
          if (mem.oppRecentGoods.length > 6) mem.oppRecentGoods.shift();
        }
        break;
      case 'camels':
        for (const c of e.cards) remember(c.id, c.type);
        for (const r of e.refill) remember(r.id, r.type);
        if (e.player === oppSeat) {
          mem.oppProfile.camelTakes += 1;
          if (mem.trackedOppHerd !== null) mem.trackedOppHerd += e.cards.length;
        }
        break;
      case 'exchange':
        for (const c of e.took) remember(c.id, c.type);
        for (const c of e.gave) remember(c.id, c.type);
        if (e.player === oppSeat) {
          mem.oppProfile.exchanges += 1;
          for (const c of e.took) {
            if (c.type !== 'camel') {
              mem.oppRecentGoods.push(c.type);
              if (mem.oppRecentGoods.length > 6) mem.oppRecentGoods.shift();
            } else if (mem.trackedOppHerd !== null) {
              mem.trackedOppHerd += 1;
            }
          }
          if (mem.trackedOppHerd !== null) {
            const gaveCamels = e.gave.filter((c) => c.type === 'camel').length;
            mem.trackedOppHerd = Math.max(0, mem.trackedOppHerd - gaveCamels);
          }
        }
        break;
      case 'sell':
        for (const c of e.cards) remember(c.id, c.type);
        if (e.player === oppSeat) {
          mem.oppProfile.sells += 1;
          if (e.cards.length >= 4) mem.oppProfile.bigSells += 1;
          else if (
            e.cards.length <= 2 &&
            e.good !== 'diamond' &&
            e.good !== 'gold' &&
            e.good !== 'silver'
          ) {
            mem.oppProfile.smallCheapSells += 1;
          }
          // Opponent just sold this good; clear stale recent-interest markers for it
          mem.oppRecentGoods = mem.oppRecentGoods.filter((g) => g !== e.good);
        }
        break;
      default:
        break;
    }
  }

  const opp = view.players[oppSeat]!;
  if (opp.herdCount !== null) {
    mem.trackedOppHerd = opp.herdCount;
  } else if (!opp.hasCamels) {
    mem.trackedOppHerd = 0;
  } else if (mem.trackedOppHerd !== null && mem.trackedOppHerd < 1) {
    mem.trackedOppHerd = 1;
  }
}

export interface OpponentBelief {
  /** Exact known count of each good currently in opponent's hand (from public market takes/exchanges) */
  knownHand: Record<Good, number>;
  /** Expected total count of each good in opponent's hand (known + Bayesian unseen) */
  expectedHand: Record<Good, number>;
  /** Remaining unseen copies of each good across (deck + opponent's unknown hand slots) */
  unseenGoods: Record<Good, number>;
  /** Probability that a single random flip from the deck reveals each card type */
  deckProb: Record<CardType, number>;
  /** Goods the opponent visibly sought recently (for denial & race urgency) */
  recentInterest: Record<Good, number>;
  /** Best legal estimate of opponent's camel herd size */
  oppHerdEst: number;
  /** Number of unknown cards in opponent's hand */
  unknownOppCards: number;
  /** Opponent's inferred greediness for big sets (0 = fast seller, 1 = combo hoarder) */
  oppComboBias: number;
}

function zeroGoods(): Record<Good, number> {
  return { diamond: 0, gold: 0, silver: 0, cloth: 0, spice: 0, leather: 0 };
}

/**
 * Build a fair, public-information belief about opponent's hand and deck composition.
 * Works both with a persistent BotMemory (full round card tracking) and statelessly
 * (extracting opponent's immediately previous public action from view.lastEvents).
 */
export function buildOpponentBelief(
  view: PlayerView,
  me: number,
  memory?: BotMemory,
): OpponentBelief {
  const oppSeat = 1 - me;
  const selfP = view.players[me]!;
  const oppP = view.players[oppSeat]!;

  const knownHand = zeroGoods();
  const recentInterest = zeroGoods();

  // Collect publicly known card types in opponent's current handIds
  const knownLookup: Record<string, CardType> = memory ? { ...memory.knownCards } : {};
  // Even without persistent memory, always read view.lastEvents (100% public)
  for (const e of view.lastEvents) {
    if (e.type === 'take') {
      knownLookup[e.card.id] = e.card.type;
      if (e.player === oppSeat && e.card.type !== 'camel') {
        recentInterest[e.card.type] += 1;
      }
    } else if (e.type === 'exchange') {
      for (const c of e.took) {
        knownLookup[c.id] = c.type;
        if (e.player === oppSeat && c.type !== 'camel') {
          recentInterest[c.type] += 1;
        }
      }
      for (const c of e.gave) knownLookup[c.id] = c.type;
    } else if (e.type === 'sell') {
      for (const c of e.cards) knownLookup[c.id] = c.type;
    }
  }

  if (memory) {
    memory.oppRecentGoods.forEach((g, idx) => {
      // More recent picks weigh more strongly
      const weight = (idx + 1) / memory.oppRecentGoods.length;
      recentInterest[g] = Math.max(recentInterest[g], weight);
    });
  }

  let knownTotal = 0;
  for (const id of oppP.handIds) {
    const t = knownLookup[id];
    if (t && t !== 'camel') {
      knownHand[t] += 1;
      knownTotal += 1;
    }
  }

  // Own hand & market counts
  const myHand = zeroGoods();
  for (const c of selfP.hand ?? []) {
    if (c.type !== 'camel') myHand[c.type] += 1;
  }
  const marketGoods = zeroGoods();
  let marketCamels = 0;
  for (const c of view.market) {
    if (c.type === 'camel') marketCamels += 1;
    else marketGoods[c.type] += 1;
  }

  // Sold / discarded counts (using discard when browsable, else tokens taken as proxy)
  const soldGoods = zeroGoods();
  if (view.rules.discardBrowsable) {
    for (const c of view.discard) {
      if (c.type !== 'camel') soldGoods[c.type] += 1;
    }
  } else {
    for (const g of GOODS) {
      // Approximate sold cards by tokens taken (exact unless pile emptied early)
      const pileLen = view.goodsPiles[g].length;
      soldGoods[g] = Math.max(0, TOKEN_VALUES[g].length - pileLen);
    }
  }

  // Opponent herd estimate
  const myHerd = selfP.herdIds?.length ?? 0;
  let oppHerdEst: number;
  if (oppP.herdCount !== null) {
    oppHerdEst = oppP.herdCount;
  } else if (memory?.trackedOppHerd !== null && memory?.trackedOppHerd !== undefined) {
    oppHerdEst = memory.trackedOppHerd;
  } else if (!oppP.hasCamels) {
    oppHerdEst = 0;
  } else {
    oppHerdEst = Math.max(1, Math.min(3, Math.round((CAMEL_CARD_COUNT - marketCamels - myHerd) / 3)));
  }

  // Unseen cards pool:
  // Crucial Jaipur invariant: opponent's hidden hand NEVER contains camels!
  // So unseen camels live 100% in the deck, while unknown opponent hand cards
  // come exclusively from the unseen goods pool.
  const unseenGoods = zeroGoods();
  let totalUnseenGoods = 0;
  for (const g of GOODS) {
    const u = Math.max(
      0,
      CARD_COUNTS[g] - myHand[g] - marketGoods[g] - soldGoods[g] - knownHand[g],
    );
    unseenGoods[g] = u;
    totalUnseenGoods += u;
  }

  const unknownOppCards = Math.max(0, oppP.handCount - knownTotal);
  const expectedHand = zeroGoods();
  for (const g of GOODS) {
    const share =
      totalUnseenGoods > 0 ? (unknownOppCards * unseenGoods[g]) / totalUnseenGoods : 0;
    expectedHand[g] = Math.min(CARD_COUNTS[g], knownHand[g] + share);
  }

  // Deck flip probabilities
  const unseenCamels = Math.max(0, CAMEL_CARD_COUNT - marketCamels - myHerd - oppHerdEst);
  const deckProb: Record<CardType, number> = {
    diamond: 0,
    gold: 0,
    silver: 0,
    cloth: 0,
    spice: 0,
    leather: 0,
    camel: 0,
  };
  if (view.deckCount > 0) {
    let deckMass = unseenCamels;
    const deckGoods = zeroGoods();
    for (const g of GOODS) {
      const inDeck = Math.max(0, unseenGoods[g] - (expectedHand[g] - knownHand[g]));
      deckGoods[g] = inDeck;
      deckMass += inDeck;
    }
    if (deckMass > 0) {
      deckProb.camel = unseenCamels / deckMass;
      for (const g of GOODS) deckProb[g] = deckGoods[g] / deckMass;
    }
  }

  // Infer opponent's combo greediness from observed match behavior
  let oppComboBias = 0.5;
  if (memory && memory.oppProfile.sells >= 2) {
    const bigRate = memory.oppProfile.bigSells / memory.oppProfile.sells;
    const smallRate = memory.oppProfile.smallCheapSells / memory.oppProfile.sells;
    oppComboBias = Math.max(0.15, Math.min(0.85, 0.5 + 0.45 * (bigRate - smallRate)));
  }

  return {
    knownHand,
    expectedHand,
    unseenGoods,
    deckProb,
    recentInterest,
    oppHerdEst,
    unknownOppCards,
    oppComboBias,
  };
}
