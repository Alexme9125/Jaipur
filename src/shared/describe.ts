import { GOODS_META } from './engine/index';
import { rupeesToTokens, formatTokens } from './format';
import type { Card, GameEvent, RoundEndReason } from './engine/types';

const ROUND_END_TEXT: Record<RoundEndReason, string> = {
  tokens: '3 种货物代币已卖空，本轮结束',
  deck: '牌堆补不出牌，本轮结束',
  stall: '牌堆耗尽后连续交换 6 回合，本轮结束',
};

export function describeRoundEnd(reason: RoundEndReason): string {
  return ROUND_END_TEXT[reason];
}

function countByType(cards: Card[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cards) m.set(c.type, (m.get(c.type) ?? 0) + 1);
  return m;
}

/** "2 张皮革、1 头骆驼" — goods counted, camels as heads */
function giveText(cards: Card[]): string {
  const counts = countByType(cards);
  const parts: string[] = [];
  let camels = 0;
  for (const [t, n] of counts) {
    if (t === 'camel') camels = n;
    else parts.push(`${n} 张${GOODS_META[t as keyof typeof GOODS_META].zh}`);
  }
  if (camels > 0) parts.push(`${camels} 头骆驼`);
  return parts.join('、');
}

/** "黄金、白银、香料" — taken cards named once per card */
function takeText(cards: Card[]): string {
  const names = cards.map((c) => GOODS_META[c.type].zh);
  const goods = names.filter((n) => n !== '骆驼');
  const camels = names.length - goods.length;
  const parts = [...goods];
  if (camels > 0) parts.push(`${camels} 头骆驼`);
  return parts.join('、');
}

export interface DescribedEvent {
  seat: number | null;
  text: string;
}

/** Plain-Chinese event text for the caption line and the log drawer. */
export function describeEvent(e: GameEvent, names: [string, string]): DescribedEvent | null {
  const who = (seat: number) => names[seat] ?? `玩家${seat + 1}`;
  switch (e.type) {
    case 'take':
      return { seat: e.player, text: `${who(e.player)} 取走 1 张${GOODS_META[e.card.type].zh}` };
    case 'camels':
      return { seat: e.player, text: `${who(e.player)} 收走 ${e.cards.length} 头骆驼` };
    case 'exchange':
      return {
        seat: e.player,
        text: `${who(e.player)} 用 ${giveText(e.gave)} 换走 ${takeText(e.took)}`,
      };
    case 'sell': {
      const n = e.cards.length;
      const sum = e.tokens.reduce((s, t) => s + t.value, 0);
      let text = `${who(e.player)} 卖出 ${n} 张${GOODS_META[e.good].zh}，得 ${formatTokens(rupeesToTokens(sum))}`;
      if (e.bonus) text += `，拿到 1 枚 ${e.bonus.tier} 张奖励`;
      return { seat: e.player, text };
    }
    case 'roundStart':
      return { seat: null, text: `第 ${e.round} 轮开始，${who(e.starter)} 先手` };
    case 'roundEnd':
      return { seat: null, text: ROUND_END_TEXT[e.reason] };
    case 'matchEnd':
      return {
        seat: null,
        text:
          e.winners.length === 2
            ? '整场平局'
            : `${who(e.winners[0]!)} 赢下整场`,
      };
  }
}
