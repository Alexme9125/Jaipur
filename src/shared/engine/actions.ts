import { GOODS, GOODS_META, HAND_LIMIT, PRECIOUS } from './constants';
import type { Action, ActionContext, Card, CardType, Good } from './types';

export type ActionCheck = { ok: true } | { ok: false; reason: string };

function countByType(cards: Card[]): Map<CardType, number> {
  const m = new Map<CardType, number>();
  for (const c of cards) m.set(c.type, (m.get(c.type) ?? 0) + 1);
  return m;
}

function hasDuplicates(ids: string[]): boolean {
  return new Set(ids).size !== ids.length;
}

export function checkAction(ctx: ActionContext, action: Action): ActionCheck {
  switch (action.type) {
    case 'take': {
      const card = ctx.market.find((c) => c.id === action.cardId);
      if (!card) return { ok: false, reason: '这张牌不在市场里' };
      if (card.type === 'camel') {
        return { ok: false, reason: '取一张只能拿货物牌，骆驼请用「收走骆驼」' };
      }
      if (ctx.hand.length >= HAND_LIMIT) {
        return { ok: false, reason: `手牌已满 ${HAND_LIMIT} 张，不能再取牌` };
      }
      return { ok: true };
    }
    case 'camels': {
      if (!ctx.market.some((c) => c.type === 'camel')) {
        return { ok: false, reason: '市场里没有骆驼' };
      }
      return { ok: true };
    }
    case 'sell': {
      if (action.cardIds.length === 0) return { ok: false, reason: '卖出至少要 1 张牌' };
      if (hasDuplicates(action.cardIds)) return { ok: false, reason: '不能重复卖出同一张牌' };
      const inHand = new Set(ctx.hand.map((c) => c.id));
      if (!action.cardIds.every((id) => inHand.has(id))) {
        return { ok: false, reason: '要卖的牌不在你的手里' };
      }
      const types = new Set(action.cardIds.map((id) => ctx.hand.find((c) => c.id === id)!.type));
      if (types.size > 1) return { ok: false, reason: '一次只能卖一种货物' };
      const t = [...types][0]!;
      if (t === 'camel') return { ok: false, reason: '骆驼不能卖' };
      if (PRECIOUS.includes(t) && action.cardIds.length < 2) {
        return { ok: false, reason: `${GOODS_META[t].zh}一次至少要卖 2 张` };
      }
      return { ok: true };
    }
    case 'exchange': {
      const { take, give } = action;
      if (hasDuplicates(take) || hasDuplicates(give)) {
        return { ok: false, reason: '同一张牌不能重复使用' };
      }
      const marketById = new Map(ctx.market.map((c) => [c.id, c]));
      const takenCards: Card[] = [];
      for (const id of take) {
        const c = marketById.get(id);
        if (!c) return { ok: false, reason: '要拿的牌不在市场里' };
        takenCards.push(c);
      }
      if (take.length < 2) return { ok: false, reason: '交换至少要拿 2 张货物' };
      const handById = new Map(ctx.hand.map((c) => [c.id, c]));
      const herdById = new Map(ctx.herd.map((c) => [c.id, c]));
      const givenCards: Card[] = [];
      for (const id of give) {
        const c = handById.get(id) ?? herdById.get(id);
        if (!c) return { ok: false, reason: '交出的牌不在你的手牌或骆驼群里' };
        givenCards.push(c);
      }
      if (give.length !== take.length) {
        const diff = take.length - give.length;
        return {
          ok: false,
          reason:
            diff > 0
              ? `交出的牌数要和拿走的一样：还差 ${diff} 张`
              : `交出的牌数要和拿走的一样：多了 ${-diff} 张`,
        };
      }
      const takenCamels = takenCards.filter((c) => c.type === 'camel').length;
      if (takenCamels > 0 && !ctx.rules.exchangeMayTakeCamels) {
        return { ok: false, reason: '交换只能拿货物牌，不能拿骆驼' };
      }
      const givenCamels = givenCards.filter((c) => c.type === 'camel').length;
      if (takenCamels > 0 && givenCamels > 0) {
        return { ok: false, reason: '拿骆驼的交换里不能再交出骆驼' };
      }
      if (ctx.rules.exchangeSameTypeForbidden) {
        const takenTypes = countByType(takenCards);
        for (const g of givenCards) {
          if (g.type !== 'camel' && (takenTypes.get(g.type) ?? 0) > 0) {
            return {
              ok: false,
              reason: `不能交出和拿走同一种货物（${GOODS_META[g.type].zh}）`,
            };
          }
        }
      }
      const newHandSize = ctx.hand.length - (give.length - givenCamels) + (take.length - takenCamels);
      if (newHandSize > HAND_LIMIT) {
        return {
          ok: false,
          reason: `交换后手牌会有 ${newHandSize} 张，超过上限 ${HAND_LIMIT} 张`,
        };
      }
      return { ok: true };
    }
  }
}

/**
 * All legal actions for the context's player. Exchanges are enumerated as
 * canonical type-multisets (subsets of market types × multisets of give types)
 * mapped to concrete ids, so no id-permutation duplicates are emitted.
 */
export function enumerateActions(ctx: ActionContext): Action[] {
  const out: Action[] = [];

  if (ctx.hand.length < HAND_LIMIT) {
    for (const c of ctx.market) {
      if (c.type !== 'camel') out.push({ type: 'take', cardId: c.id });
    }
  }

  if (ctx.market.some((c) => c.type === 'camel')) out.push({ type: 'camels' });

  // sell: every legal count of each good type in hand
  const handCounts = countByType(ctx.hand);
  const handIdsByType = new Map<CardType, string[]>();
  for (const c of ctx.hand) {
    const arr = handIdsByType.get(c.type) ?? [];
    arr.push(c.id);
    handIdsByType.set(c.type, arr);
  }
  for (const g of GOODS) {
    const ids = handIdsByType.get(g) ?? [];
    const min = PRECIOUS.includes(g) ? 2 : 1;
    for (let k = min; k <= ids.length; k++) {
      out.push({ type: 'sell', cardIds: ids.slice(0, k) });
    }
  }

  out.push(...enumerateExchanges(ctx, handCounts, handIdsByType));
  return out;
}

function enumerateExchanges(
  ctx: ActionContext,
  handCounts: Map<CardType, number>,
  handIdsByType: Map<CardType, string[]>,
): Action[] {
  const out: Action[] = [];

  // market availability by type, ids in market order
  const takeTypes: CardType[] = ctx.rules.exchangeMayTakeCamels
    ? [...GOODS, 'camel']
    : [...GOODS];
  const marketIdsByType = new Map<CardType, string[]>();
  for (const c of ctx.market) {
    const arr = marketIdsByType.get(c.type) ?? [];
    arr.push(c.id);
    marketIdsByType.set(c.type, arr);
  }

  // give availability: hand goods + herd camels
  const giveTypes: CardType[] = [...GOODS, 'camel'];
  const herdIds = ctx.herd.map((c) => c.id);

  const takeCounts = new Map<CardType, number>();
  const recTake = (i: number, total: number) => {
    if (i === takeTypes.length) {
      if (total >= 2) enumerateGives(ctx, takeCounts, total, handCounts, handIdsByType, herdIds, marketIdsByType, out);
      return;
    }
    const t = takeTypes[i]!;
    const avail = marketIdsByType.get(t)?.length ?? 0;
    for (let n = 0; n <= avail; n++) {
      takeCounts.set(t, n);
      recTake(i + 1, total + n);
    }
    takeCounts.set(t, 0);
  };
  recTake(0, 0);
  return out;
}

function enumerateGives(
  ctx: ActionContext,
  takeCounts: Map<CardType, number>,
  total: number,
  handCounts: Map<CardType, number>,
  handIdsByType: Map<CardType, string[]>,
  herdIds: string[],
  marketIdsByType: Map<CardType, string[]>,
  out: Action[],
): void {
  const tookCamels = takeCounts.get('camel') ?? 0;
  const tookGoods = total - tookCamels;

  const giveTypes: CardType[] = [...GOODS, 'camel'];
  const caps = new Map<CardType, number>();
  for (const g of GOODS) caps.set(g, handCounts.get(g) ?? 0);
  caps.set('camel', tookCamels > 0 ? 0 : herdIds.length);

  const giveCounts = new Map<CardType, number>();
  const recGive = (i: number, remaining: number) => {
    if (i === giveTypes.length) {
      if (remaining !== 0) return;
      emitExchange(ctx, takeCounts, giveCounts, handIdsByType, herdIds, marketIdsByType, out);
      return;
    }
    const t = giveTypes[i]!;
    const cap = Math.min(caps.get(t) ?? 0, remaining);
    for (let n = 0; n <= cap; n++) {
      giveCounts.set(t, n);
      recGive(i + 1, remaining - n);
    }
    giveCounts.set(t, 0);
  };
  recGive(0, total);
}

function emitExchange(
  ctx: ActionContext,
  takeCounts: Map<CardType, number>,
  giveCounts: Map<CardType, number>,
  handIdsByType: Map<CardType, string[]>,
  herdIds: string[],
  marketIdsByType: Map<CardType, string[]>,
  out: Action[],
): void {
  const gaveCamels = giveCounts.get('camel') ?? 0;
  const tookCamels = takeCounts.get('camel') ?? 0;
  let gaveGoods = 0;
  let tookGoods = 0;
  for (const g of GOODS) {
    const giveN = giveCounts.get(g) ?? 0;
    const takeN = takeCounts.get(g) ?? 0;
    gaveGoods += giveN;
    tookGoods += takeN;
    if (ctx.rules.exchangeSameTypeForbidden && giveN > 0 && takeN > 0) return;
  }
  const newHand = ctx.hand.length - gaveGoods + tookGoods;
  if (newHand > HAND_LIMIT) return;

  const take: string[] = [];
  for (const t of [...GOODS, 'camel'] as CardType[]) {
    const n = takeCounts.get(t) ?? 0;
    if (n > 0) take.push(...(marketIdsByType.get(t) ?? []).slice(0, n));
  }
  const give: string[] = [];
  for (const g of GOODS) {
    const n = giveCounts.get(g) ?? 0;
    if (n > 0) give.push(...(handIdsByType.get(g) ?? []).slice(0, n));
  }
  if (gaveCamels > 0) give.push(...herdIds.slice(0, gaveCamels));

  out.push({ type: 'exchange', take, give });
}
