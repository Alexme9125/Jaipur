import { checkAction, GOODS_META } from '@shared/engine';
import { formatTokens, rupeesToTokens } from '@shared/format';
import type { ActionCheck } from '@shared/engine/actions';
import type { Action, BonusTier, CardType } from '@shared/engine/types';
import type { PlayerView } from '@shared/engine/view';
import { actionContextFromView } from '@shared/ai';

export interface Selection {
  /** selected market goods card ids */
  marketGoods: ReadonlySet<string>;
  /** all market camels selected */
  marketCamels: boolean;
  /** selected own-hand card ids */
  hand: ReadonlySet<string>;
  /** camels given via the stepper */
  giveCamels: number;
}

export const EMPTY_SELECTION: Selection = {
  marketGoods: new Set(),
  marketCamels: false,
  hand: new Set(),
  giveCamels: 0,
};

export interface Inferred {
  action: Action | null;
  check: ActionCheck | null;
  /** primary action button label */
  button: string;
  /** status line text — hint or invalid reason */
  status: string;
  /** sell preview like "+9K · 奖励 ×3" */
  preview: string | null;
}

export function inferAction(view: PlayerView, sel: Selection): Inferred {
  const me = view.viewer ?? 0;
  const ctx = actionContextFromView(view, me);
  const marketById = new Map(view.market.map((c) => [c.id, c]));
  const handById = new Map(ctx.hand.map((c) => [c.id, c]));
  const herdIds = ctx.herd.map((c) => c.id);
  const camelsInMarket = view.market.filter((c) => c.type === 'camel').length;
  const zh = (t: CardType) => GOODS_META[t].zh;

  const takeIds = [...sel.marketGoods];
  const giveIds = [...sel.hand, ...herdIds.slice(0, sel.giveCamels)];

  let action: Action | null = null;
  let button = '行动';
  let status = '';
  let preview: string | null = null;

  if (sel.marketCamels) {
    action = { type: 'camels' };
    button = `收走 ${camelsInMarket} 头骆驼`;
    status = '收走市场上的所有骆驼';
  } else if (takeIds.length === 0 && sel.hand.size === 0 && sel.giveCamels === 0) {
    status = '选市场里的牌来拿，或选手牌来卖';
  } else if (takeIds.length === 0 && sel.hand.size > 0) {
    const ids = [...sel.hand];
    action = { type: 'sell', cardIds: ids };
    const t = ids.length > 0 ? handById.get(ids[0]!)?.type : null;
    const sameType = ids.every((id) => handById.get(id)?.type === t);
    if (sameType && t) {
      button = `卖出 ${ids.length} 张${zh(t)}`;
      const pile = view.goodsPiles[t as keyof typeof view.goodsPiles] ?? [];
      const sum = pile.slice(0, ids.length).reduce((s, tok) => s + tok.value, 0);
      preview = `+${formatTokens(rupeesToTokens(sum))}`;
      if (ids.length >= 3) {
        const tier: BonusTier = ids.length >= 5 ? 5 : ids.length === 4 ? 4 : 3;
        if (view.bonusPileCounts[tier] > 0) preview += ` · 奖励 ×${tier}`;
      }
    } else {
      button = `卖出 ${ids.length} 张`;
    }
    status = '卖出同类货物换取代币';
  } else if (takeIds.length === 1 && sel.hand.size === 0 && sel.giveCamels === 0) {
    action = { type: 'take', cardId: takeIds[0]! };
    const t = marketById.get(takeIds[0]!)?.type;
    button = t ? `取走${zh(t)}` : '取走';
    status = '从市场取一张货物牌';
  } else if (takeIds.length > 0) {
    action = { type: 'exchange', take: takeIds, give: giveIds };
    button = `交换 ${takeIds.length} 张`;
    status = '用等量手牌或骆驼交换市场货物';
  } else {
    // hand/gives without any market goods is a sell attempt
    if (sel.hand.size > 0) {
      action = { type: 'sell', cardIds: [...sel.hand] };
      button = `卖出 ${sel.hand.size} 张`;
    }
    status = '选市场里的牌来拿，或选手牌来卖';
  }

  const check = action ? checkAction(ctx, action) : null;
  if (check && !check.ok) {
    status = check.reason;
    preview = null;
  }

  return { action, check, button, status, preview };
}
