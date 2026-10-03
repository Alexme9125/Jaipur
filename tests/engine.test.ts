import { describe, expect, test } from 'vitest';
import {
  applyAction,
  checkAction,
  createMatch,
  enumerateActions,
  IllegalActionError,
  nextRound,
  actionContextFor,
  viewFor,
  GOODS,
  TOKEN_VALUES,
  type Card,
  type GameState,
} from '../src/shared/engine';
import { formatTokens, rupeesToTokens } from '../src/shared/format';
import { mkBonus, mkCard, mkState, mkToken } from './helpers';

const err = (s: GameState, player: number, a: Parameters<typeof applyAction>[2]) => {
  try {
    applyAction(s, player, a);
    return null;
  } catch (e) {
    if (e instanceof IllegalActionError) return e.reason;
    throw e;
  }
};

function allGoodsMarket(s: GameState): void {
  s.market = [
    mkCard('m0', 'spice'),
    mkCard('m1', 'cloth'),
    mkCard('m2', 'leather'),
    mkCard('m3', 'gold'),
    mkCard('m4', 'diamond'),
  ];
}

/** Craft a state where one more sale of leather ends the round on tokens. */
function nearTokensEnd(s: GameState): void {
  for (const g of GOODS) s.goodsPiles[g] = [];
  s.goodsPiles.leather = [mkToken('leather', 4)];
  s.players[0]!.hand = [mkCard('h0', 'leather')];
  s.players[1]!.hand = [mkCard('x0', 'cloth'), mkCard('x1', 'cloth')];
}

/**
 * All token piles empty: selling 'h0' ends the round on 'tokens' and gains
 * nothing, so crafted token/herd positions are scored exactly as written.
 */
function deadRound(s: GameState, actor = 0): void {
  for (const g of GOODS) s.goodsPiles[g] = [];
  s.players[actor]!.hand = [mkCard('h0', 'leather')];
  s.players[1 - actor]!.hand = [mkCard('x0', 'cloth')];
}

describe('setup', () => {
  test('deals per RULES §3', () => {
    const s = createMatch({ seed: 42 });
    expect(s.players).toHaveLength(2);
    expect(s.market).toHaveLength(5);
    expect(s.market.slice(0, 3).every((c) => c.type === 'camel')).toBe(true);
    for (const p of s.players) {
      expect(p.hand.length + p.herd.length).toBe(5);
      expect(p.hand.every((c) => c.type !== 'camel')).toBe(true);
      expect(p.herd.every((c) => c.type === 'camel')).toBe(true);
    }
    expect(s.deck).toHaveLength(40);
    for (const g of GOODS) expect(s.goodsPiles[g]).toHaveLength(TOKEN_VALUES[g].length);
    expect(s.goodsPiles.diamond[0]!.value).toBe(7);
    expect(s.bonusPiles[3]).toHaveLength(7);
    expect(s.bonusPiles[4]).toHaveLength(6);
    expect(s.bonusPiles[5]).toHaveLength(5);
    expect(s.round).toBe(1);
    expect(s.turn).toBe(0);
    expect(s.phase).toBe('playing');
    expect(s.current).toBe(s.starter);
    expect(s.lastEvents).toEqual([{ type: 'roundStart', round: 1, starter: s.starter }]);
  });

  test('starter option is honored; default starter is in range', () => {
    expect(createMatch({ seed: 1, starter: 1 }).starter).toBe(1);
    for (let seed = 0; seed < 10; seed++) {
      expect([0, 1]).toContain(createMatch({ seed }).starter);
    }
  });

  test('card ids carry no type or position info', () => {
    const s = createMatch({ seed: 7 });
    const ids = [...s.deck, ...s.market].map((c) => c.id);
    // ids are opaque random strings — the same type gets unrelated ids
    for (const id of ids) expect(GOODS.every((g) => !id.includes(g))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('take', () => {
  test('takes one good into hand, refills the same slot', () => {
    const s = mkState(allGoodsMarket);
    const before = s.deck[0]!;
    const s2 = applyAction(s, 0, { type: 'take', cardId: 'm1' });
    expect(s2.players[0]!.hand.some((c) => c.id === 'm1')).toBe(true);
    expect(s2.market).toHaveLength(5);
    expect(s2.market[1]!.id).toBe(before.id); // refill lands in vacated slot
    expect(s2.market[0]!.id).toBe('m0');
    expect(s2.deck).toHaveLength(s.deck.length - 1);
    expect(s2.turn).toBe(1);
    expect(s2.current).toBe(1);
  });

  test('cannot take a camel or an absent card', () => {
    const s = mkState();
    const camel = s.market.find((c) => c.type === 'camel')!;
    expect(err(s, 0, { type: 'take', cardId: camel.id })).toContain('收走骆驼');
    expect(err(s, 0, { type: 'take', cardId: 'nope' })).toBe('这张牌不在市场里');
  });

  test('hand limit 7 blocks take', () => {
    const s = mkState((st) => {
      allGoodsMarket(st);
      st.players[0]!.hand = Array.from({ length: 7 }, (_, i) => mkCard(`h${i}`, 'leather'));
    });
    expect(err(s, 0, { type: 'take', cardId: 'm0' })).toBe('手牌已满 7 张，不能再取牌');
  });

  test('wrong player and wrong phase throw', () => {
    const s = mkState(allGoodsMarket);
    expect(err(s, 1, { type: 'take', cardId: 'm0' })).toBe('还没轮到你行动');
    const over = mkState((st) => {
      st.phase = 'roundOver';
    });
    expect(err(over, 0, { type: 'take', cardId: 'm0' })).toBe('本轮已结束，请进入下一轮');
    const done = mkState((st) => {
      st.phase = 'matchOver';
    });
    expect(err(done, 0, { type: 'take', cardId: 'm0' })).toBe('整场已结束');
  });
});

describe('camels', () => {
  test('takes every market camel and refills that many', () => {
    const s = mkState((st) => {
      st.market = [
        mkCard('m0', 'camel'),
        mkCard('m1', 'spice'),
        mkCard('m2', 'camel'),
        mkCard('m3', 'gold'),
        mkCard('m4', 'cloth'),
      ];
    });
    const d0 = s.deck[0]!.id;
    const d1 = s.deck[1]!.id;
    const herdBefore = s.players[0]!.herd.length;
    const s2 = applyAction(s, 0, { type: 'camels' });
    expect(s2.players[0]!.herd).toHaveLength(herdBefore + 2);
    expect(s2.market.map((c) => c.id)).toEqual([d0, 'm1', d1, 'm3', 'm4']);
    expect(s2.deck).toHaveLength(s.deck.length - 2);
  });

  test('illegal when no camel in market', () => {
    const s = mkState(allGoodsMarket);
    expect(err(s, 0, { type: 'camels' })).toBe('市场里没有骆驼');
  });
});

describe('exchange', () => {
  const setup = () =>
    mkState((st) => {
      st.market = [
        mkCard('m0', 'spice'),
        mkCard('m1', 'cloth'),
        mkCard('m2', 'leather'),
        mkCard('m3', 'camel'),
        mkCard('m4', 'gold'),
      ];
      st.players[0]!.hand = [mkCard('h0', 'diamond'), mkCard('h1', 'diamond'), mkCard('h2', 'gold')];
      st.players[0]!.herd = [mkCard('c0', 'camel'), mkCard('c1', 'camel')];
    });

  test('basic swap: given cards fill vacated slots in order', () => {
    const s = setup();
    const s2 = applyAction(s, 0, { type: 'exchange', take: ['m4', 'm0'], give: ['h0', 'h1'] });
    // vacated slots [0,4] get give[0],give[1]
    expect(s2.market.map((c) => c.id)).toEqual(['h0', 'm1', 'm2', 'm3', 'h1']);
    expect(s2.players[0]!.hand.map((c) => c.id).sort()).toEqual(['h2', 'm0', 'm4']);
    expect(s2.deck).toHaveLength(s.deck.length); // exchange never refills
  });

  test('requires at least two taken and equal counts', () => {
    const s = setup();
    expect(err(s, 0, { type: 'exchange', take: ['m0'], give: ['h0'] })).toBe(
      '交换至少要拿 2 张货物',
    );
    expect(err(s, 0, { type: 'exchange', take: ['m0', 'm1'], give: ['h0'] })).toBe(
      '交出的牌数要和拿走的一样：还差 1 张',
    );
    expect(err(s, 0, { type: 'exchange', take: ['m0', 'm1'], give: ['h0', 'h1', 'h2'] })).toBe(
      '交出的牌数要和拿走的一样：多了 1 张',
    );
  });

  test('can give herd camels', () => {
    const s = setup();
    const s2 = applyAction(s, 0, { type: 'exchange', take: ['m0', 'm1'], give: ['c0', 'c1'] });
    expect(s2.players[0]!.herd).toHaveLength(0);
    expect(s2.market.slice(0, 2).map((c) => c.type)).toEqual(['camel', 'camel']);
    expect(s2.players[0]!.hand).toHaveLength(5);
  });

  test('taking camels is off by default, works when enabled', () => {
    const s = setup();
    expect(err(s, 0, { type: 'exchange', take: ['m3', 'm0'], give: ['h0', 'h1'] })).toBe(
      '交换只能拿货物牌，不能拿骆驼',
    );
    const on = mkState(
      (st) => {
        st.market = [mkCard('m0', 'spice'), mkCard('m1', 'cloth'), mkCard('m3', 'camel'), mkCard('m4', 'gold'), mkCard('m5', 'leather')];
        st.players[0]!.hand = [mkCard('h0', 'diamond'), mkCard('h1', 'diamond'), mkCard('h2', 'gold')];
        st.players[0]!.herd = [mkCard('c0', 'camel')];
      },
      { rules: { exchangeMayTakeCamels: true } },
    );
    const s2 = applyAction(on, 0, { type: 'exchange', take: ['m3', 'm0'], give: ['h0', 'h1'] });
    expect(s2.players[0]!.herd.map((c) => c.id)).toEqual(['c0', 'm3']); // taken camel joins herd
    expect(s2.players[0]!.hand.map((c) => c.id)).toEqual(['h2', 'm0']);
    // cannot also give camels in the same exchange
    expect(err(on, 0, { type: 'exchange', take: ['m3', 'm0'], give: ['c0', 'h0'] })).toBe(
      '拿骆驼的交换里不能再交出骆驼',
    );
  });

  test('same-type swap forbidden by default, allowed when toggled', () => {
    const s = mkState((st) => {
      st.market = [mkCard('m0', 'spice'), mkCard('m1', 'cloth'), mkCard('m2', 'leather'), mkCard('m3', 'gold'), mkCard('m4', 'diamond')];
      st.players[0]!.hand = [mkCard('h0', 'spice'), mkCard('h1', 'diamond')];
    });
    expect(err(s, 0, { type: 'exchange', take: ['m0', 'm1'], give: ['h0', 'h1'] })).toBe(
      '不能交出和拿走同一种货物（香料）',
    );
    const off = mkState(
      (st) => {
        st.market = [mkCard('m0', 'spice'), mkCard('m1', 'cloth'), mkCard('m2', 'leather'), mkCard('m3', 'gold'), mkCard('m4', 'diamond')];
        st.players[0]!.hand = [mkCard('h0', 'spice'), mkCard('h1', 'diamond')];
      },
      { rules: { exchangeSameTypeForbidden: false } },
    );
    const s2 = applyAction(off, 0, { type: 'exchange', take: ['m0', 'm1'], give: ['h0', 'h1'] });
    expect(s2.players[0]!.hand.map((c) => c.id).sort()).toEqual(['m0', 'm1']);
  });

  test('hand limit applies after exchange (gave camels do not free slots)', () => {
    const s = mkState((st) => {
      st.market = [mkCard('m0', 'spice'), mkCard('m1', 'cloth'), mkCard('m2', 'leather'), mkCard('m3', 'gold'), mkCard('m4', 'diamond')];
      st.players[0]!.hand = Array.from({ length: 7 }, (_, i) => mkCard(`h${i}`, 'leather'));
      st.players[0]!.herd = [mkCard('c0', 'camel')];
    });
    expect(err(s, 0, { type: 'exchange', take: ['m0', 'm1'], give: ['h0', 'c0'] })).toBe(
      '交换后手牌会有 8 张，超过上限 7 张',
    );
  });

  test('rejects cards not owned / not in market', () => {
    const s = setup();
    expect(err(s, 0, { type: 'exchange', take: ['m0', 'zz'], give: ['h0', 'h1'] })).toBe(
      '要拿的牌不在市场里',
    );
    expect(err(s, 0, { type: 'exchange', take: ['m0', 'm1'], give: ['h0', 'zz'] })).toBe(
      '交出的牌不在你的手牌或骆驼群里',
    );
  });
});

describe('sell', () => {
  const setup = () =>
    mkState((st) => {
      st.players[0]!.hand = [
        mkCard('d0', 'diamond'),
        mkCard('d1', 'diamond'),
        mkCard('d2', 'diamond'),
        mkCard('l0', 'leather'),
        mkCard('l1', 'leather'),
        mkCard('l2', 'leather'),
        mkCard('l3', 'leather'),
      ];
    });

  test('sells from the top of the pile', () => {
    const s = setup();
    const s2 = applyAction(s, 0, { type: 'sell', cardIds: ['d0', 'd1'] });
    expect(s2.players[0]!.goodsTokens.map((t) => t.value)).toEqual([7, 7]);
    expect(s2.players[0]!.bonusTokens).toHaveLength(0);
    expect(s2.discard.map((c) => c.id)).toEqual(['d0', 'd1']);
    expect(s2.goodsPiles.diamond.map((t) => t.value)).toEqual([5, 5, 5]);
  });

  test('one type only; precious need 2; camel cannot be sold', () => {
    const s = setup();
    expect(err(s, 0, { type: 'sell', cardIds: ['d0', 'l0'] })).toBe('一次只能卖一种货物');
    expect(err(s, 0, { type: 'sell', cardIds: ['d0'] })).toBe('钻石一次至少要卖 2 张');
    const withCamel = mkState((st) => {
      st.players[0]!.hand = [mkCard('cc', 'camel')];
    });
    expect(err(withCamel, 0, { type: 'sell', cardIds: ['cc'] })).toBe('骆驼不能卖');
    expect(err(s, 0, { type: 'sell', cardIds: ['zz'] })).toBe('要卖的牌不在你的手里');
    expect(err(s, 0, { type: 'sell', cardIds: [] })).toBe('卖出至少要 1 张牌');
  });

  test('precious still need 2 when only one token remains', () => {
    const s = setup();
    s.goodsPiles.diamond = [mkToken('diamond', 5)];
    const s2 = applyAction(s, 0, { type: 'sell', cardIds: ['d0', 'd1'] });
    expect(s2.players[0]!.goodsTokens.map((t) => t.value)).toEqual([5]);
  });

  test('bonus by cards sold even when tokens run out', () => {
    const s = setup();
    s.goodsPiles.leather = [mkToken('leather', 4)];
    const s2 = applyAction(s, 0, { type: 'sell', cardIds: ['l0', 'l1', 'l2'] });
    expect(s2.players[0]!.goodsTokens.map((t) => t.value)).toEqual([4]);
    expect(s2.players[0]!.bonusTokens).toHaveLength(1);
    expect(s2.players[0]!.bonusTokens[0]!.tier).toBe(3);
  });

  test('5+ cards earn the tier-5 bonus; empty tier gives no fallback', () => {
    const s = mkState((st) => {
      st.players[0]!.hand = Array.from({ length: 6 }, (_, i) => mkCard(`l${i}`, 'leather'));
    });
    const s2 = applyAction(s, 0, { type: 'sell', cardIds: ['l0', 'l1', 'l2', 'l3', 'l4', 'l5'] });
    expect(s2.players[0]!.bonusTokens[0]!.tier).toBe(5);

    const empty = mkState((st) => {
      st.players[0]!.hand = Array.from({ length: 5 }, (_, i) => mkCard(`l${i}`, 'leather'));
      st.bonusPiles[5] = [];
    });
    const s3 = applyAction(empty, 0, {
      type: 'sell',
      cardIds: ['l0', 'l1', 'l2', 'l3', 'l4'],
    });
    expect(s3.players[0]!.bonusTokens).toHaveLength(0); // no drop to tier 4
    expect(s3.bonusPiles[4]).toHaveLength(6); // untouched
  });
});

describe('round end', () => {
  test('third depleted pile ends on tokens after the sell', () => {
    const s = mkState((st) => nearTokensEnd(st));
    const s2 = applyAction(s, 0, { type: 'sell', cardIds: ['h0'] });
    expect(s2.phase).toBe('roundOver');
    const r = s2.roundResults[0]!;
    expect(r.reason).toBe('tokens');
    expect(s2.lastEvents.at(-1)!.type).toBe('roundEnd');
  });

  test('failed refill ends the round (refillFails default)', () => {
    const s = mkState((st) => {
      allGoodsMarket(st);
      st.deck = [];
    });
    const s2 = applyAction(s, 0, { type: 'take', cardId: 'm0' });
    expect(s2.phase).toBe('roundOver');
    expect(s2.roundResults[0]!.reason).toBe('deck');
    expect(s2.market).toHaveLength(4); // could not refill
  });

  test('exact refill keeps playing under refillFails, ends under deckEmpty', () => {
    const mk = (trigger: 'refillFails' | 'deckEmpty') =>
      mkState(
        (st) => {
          allGoodsMarket(st);
          st.deck = [mkCard('dd', 'spice')];
        },
        { rules: { deckEndTrigger: trigger } },
      );
    const a = applyAction(mk('refillFails'), 0, { type: 'take', cardId: 'm0' });
    expect(a.phase).toBe('playing');
    expect(a.market).toHaveLength(5);
    expect(a.deck).toHaveLength(0);
    const b = applyAction(mk('deckEmpty'), 0, { type: 'take', cardId: 'm0' });
    expect(b.phase).toBe('roundOver');
    expect(b.roundResults[0]!.reason).toBe('deck');
    expect(b.market).toHaveLength(5); // refill succeeded but deck is empty
  });

  test('stall: 6 consecutive exchanges with empty deck end the round', () => {
    const s = mkState((st) => {
      st.deck = [];
      st.market = [
        mkCard('m0', 'spice'),
        mkCard('m1', 'cloth'),
        mkCard('m2', 'leather'),
        mkCard('m3', 'gold'),
        mkCard('m4', 'diamond'),
      ];
      st.players[0]!.herd = [mkCard('c0', 'camel'), mkCard('c1', 'camel')];
      st.players[1]!.herd = [mkCard('c2', 'camel'), mkCard('c3', 'camel')];
      st.stallCount = 4;
    });
    const s1 = applyAction(s, 0, { type: 'exchange', take: ['m0', 'm1'], give: ['c0', 'c1'] });
    expect(s1.phase).toBe('playing');
    expect(s1.stallCount).toBe(5);
    const s2 = applyAction(s1, 1, { type: 'exchange', take: ['m2', 'm3'], give: ['c2', 'c3'] });
    expect(s2.phase).toBe('roundOver');
    expect(s2.roundResults[0]!.reason).toBe('stall');
  });

  test('a non-exchange action resets the stall counter', () => {
    const s = mkState((st) => {
      st.deck = [];
      st.stallCount = 3;
      st.players[0]!.hand = [mkCard('h0', 'leather')];
      st.goodsPiles.leather = [mkToken('leather', 4), mkToken('leather', 3)];
    });
    const s2 = applyAction(s, 0, { type: 'sell', cardIds: ['h0'] });
    expect(s2.phase).toBe('playing');
    expect(s2.stallCount).toBe(0);
  });
});

describe('scoring', () => {
  /** ends the round immediately with crafted token/herd positions */
  const scored = (mut: (s: GameState) => void, rules = {}) => {
    const s = mkState((st) => {
      deadRound(st);
      mut(st);
    }, { rules });
    return applyAction(s, 0, { type: 'sell', cardIds: ['h0'] });
  };

  test('strict camel max takes the 5K token', () => {
    const s2 = scored((st) => {
      st.players[0]!.herd = [mkCard('a', 'camel'), mkCard('b', 'camel'), mkCard('c', 'camel')];
      st.players[1]!.herd = [mkCard('d', 'camel')];
    });
    expect(s2.roundResults[0]!.perPlayer[0]!.camel).toBe(5);
    expect(s2.roundResults[0]!.perPlayer[1]!.camel).toBe(0);
  });

  test('camelTie none/all on equal herds', () => {
    const mk = (camelTie: 'none' | 'all') =>
      scored(
        (st) => {
          st.players[0]!.herd = [mkCard('a', 'camel')];
          st.players[1]!.herd = [mkCard('d', 'camel')];
        },
        { camelTie },
      );
    expect(mk('none').roundResults[0]!.perPlayer.map((r) => r.camel)).toEqual([0, 0]);
    expect(mk('all').roundResults[0]!.perPlayer.map((r) => r.camel)).toEqual([5, 5]);
  });

  test('seal goes to the higher total', () => {
    const s2 = scored((st) => {
      st.players[0]!.goodsTokens = [mkToken('gold', 6)];
      st.players[1]!.goodsTokens = [mkToken('leather', 4)];
    });
    expect(s2.roundResults[0]!.sealWinners).toEqual([0]);
    expect(s2.players[0]!.seals).toBe(1);
  });

  test('tiebreak: bonus token count, then goods token count', () => {
    const byBonus = scored((st) => {
      st.players[0]!.goodsTokens = [mkToken('leather', 4)];
      st.players[0]!.bonusTokens = [mkBonus(3, 2)]; // total 6, 1 bonus
      st.players[1]!.goodsTokens = [mkToken('leather', 4), mkToken('leather', 2)]; // total 6, 0 bonus, 2 goods
    });
    expect(byBonus.roundResults[0]!.sealWinners).toEqual([0]);
    const byGoods = scored((st) => {
      st.players[0]!.goodsTokens = [mkToken('leather', 4), mkToken('leather', 2)]; // 6, 2 tokens
      st.players[1]!.goodsTokens = [mkToken('gold', 6)]; // 6, 1 token
      st.players[0]!.bonusTokens = [mkBonus(3, 1)];
      st.players[1]!.bonusTokens = [mkBonus(3, 1)]; // totals 7 vs 7, bonus 1 each
    });
    expect(byGoods.roundResults[0]!.sealWinners).toEqual([0]);
  });

  test('sealTie none gives no seal, all gives both a seal', () => {
    const tie = (st: GameState) => {
      st.players[0]!.goodsTokens = [mkToken('gold', 6)];
      st.players[1]!.goodsTokens = [mkToken('gold', 6)];
      st.players[0]!.bonusTokens = [mkBonus(3, 2)];
      st.players[1]!.bonusTokens = [mkBonus(3, 2)];
      st.players[0]!.herd = [mkCard('a', 'camel')];
      st.players[1]!.herd = [mkCard('b', 'camel')];
    };
    expect(scored(tie).roundResults[0]!.sealWinners).toEqual([]);
    expect(scored(tie, { sealTie: 'all' }).roundResults[0]!.sealWinners).toEqual([0, 1]);
  });

  test('result records per-player breakdown and revealed bonus values', () => {
    const s2 = scored((st) => {
      st.players[0]!.goodsTokens = [mkToken('gold', 6)];
      st.players[0]!.bonusTokens = [mkBonus(4, 5)];
      st.players[0]!.herd = [mkCard('a', 'camel'), mkCard('b', 'camel')];
      st.players[1]!.herd = [];
    });
    const r = s2.roundResults[0]!.perPlayer[0]!;
    expect(r).toMatchObject({ goods: 6, bonus: 5, camel: 5, total: 16, bonusCount: 1, goodsCount: 1, herd: 2, bonusValues: [5] });
    expect(s2.players[0]!.matchRupees).toBe(16);
  });
});

describe('next round starter', () => {
  /** produce an ended round whose seal winner is `winner` (null = full tie) */
  const endedRound = (winner: number | null, rules = {}, starter = 0) => {
    const s = mkState((st) => {
      st.starter = starter;
      st.current = starter;
      deadRound(st, starter);
      if (winner === 0) st.players[0]!.goodsTokens = [mkToken('gold', 6)];
      else if (winner === 1) st.players[1]!.goodsTokens = [mkToken('gold', 6)];
      else {
        st.players[0]!.goodsTokens = [mkToken('gold', 6)];
        st.players[1]!.goodsTokens = [mkToken('gold', 6)];
      }
    }, { rules });
    return applyAction(s, starter, { type: 'sell', cardIds: ['h0'] });
  };

  test('loser mode: the player without the seal starts', () => {
    expect(nextRound(endedRound(0)).starter).toBe(1);
    expect(nextRound(endedRound(1)).starter).toBe(0);
  });

  test('loser mode without a seal: the previous non-starter starts', () => {
    const s = endedRound(null, {}, 0); // tie, sealTie none → no seal
    expect(s.roundResults[0]!.sealWinners).toEqual([]);
    expect(nextRound(s).starter).toBe(1);
    const s2 = endedRound(null, {}, 1);
    expect(nextRound(s2).starter).toBe(0);
  });

  test('rotate mode alternates', () => {
    const a = nextRound(endedRound(0, { nextRoundStarter: 'rotate' }, 0));
    expect(a.starter).toBe(1);
    const b = mkState((st) => {
      st.starter = 1;
      st.current = 1;
      st.phase = 'roundOver';
      st.roundResults = a.roundResults;
      st.round = 2;
    }, { rules: { nextRoundStarter: 'rotate' } });
    expect(nextRound(b).starter).toBe(0);
  });

  test('next round re-deals a fresh layout', () => {
    const s2 = nextRound(endedRound(0));
    expect(s2.phase).toBe('playing');
    expect(s2.round).toBe(2);
    expect(s2.deck).toHaveLength(40);
    expect(s2.market).toHaveLength(5);
    expect(s2.players[0]!.goodsTokens).toHaveLength(0); // tokens are per-round
    expect(s2.lastEvents[0]).toMatchObject({ type: 'roundStart', round: 2 });
  });

  test('nextRound throws unless phase is roundOver', () => {
    const s = createMatch({ seed: 3 });
    expect(() => nextRound(s)).toThrow(IllegalActionError);
  });
});

describe('match end', () => {
  /** craft a position, then end the round with a token-less sale by player 0 */
  const endRoundWith = (mut: (s: GameState) => void, rules = {}) =>
    applyAction(
      mkState((st) => {
        deadRound(st);
        mut(st);
      }, { rules }),
      0,
      { type: 'sell', cardIds: ['h0'] },
    );

  test('first to 2 seals wins immediately', () => {
    const s2 = endRoundWith((st) => {
      st.players[0]!.seals = 1;
      st.players[0]!.goodsTokens = [mkToken('gold', 6)];
    });
    expect(s2.phase).toBe('matchOver');
    expect(s2.matchWinners).toEqual([0]);
    expect(s2.lastEvents.map((e) => e.type)).toEqual(['sell', 'roundEnd', 'matchEnd']);
  });

  test('single mode ends after one round', () => {
    const s2 = endRoundWith((st) => {
      st.players[1]!.goodsTokens = [mkToken('gold', 6)];
    }, { matchLength: 'single' });
    expect(s2.phase).toBe('matchOver');
    expect(s2.matchWinners).toEqual([1]);
  });

  test('5-round cap: seals then cumulative rupees decide', () => {
    const s2 = endRoundWith((st) => {
      st.round = 5;
      st.players[0]!.seals = 1;
      st.players[1]!.seals = 1;
      st.players[0]!.matchRupees = 60;
      st.players[1]!.matchRupees = 40;
      // tied round → no seal (sealTie none); cap compares matchRupees
      st.players[0]!.goodsTokens = [mkToken('gold', 6)];
      st.players[1]!.goodsTokens = [mkToken('gold', 6)];
    });
    expect(s2.phase).toBe('matchOver');
    expect(s2.matchWinners).toEqual([0]); // 66 vs 46 after the +6 each
  });

  test('draw at the cap yields [0,1]', () => {
    const s2 = endRoundWith((st) => {
      st.round = 5;
      st.players[0]!.seals = 1;
      st.players[1]!.seals = 1;
      st.players[0]!.goodsTokens = [mkToken('gold', 6)];
      st.players[1]!.goodsTokens = [mkToken('gold', 6)];
    });
    expect(s2.matchWinners).toEqual([0, 1]);
  });

  test('simultaneous 2 seals via sealTie=all compares matchRupees', () => {
    const mk = (r0: number, r1: number) =>
      endRoundWith(
        (st) => {
          st.players[0]!.seals = 1;
          st.players[1]!.seals = 1;
          st.players[0]!.matchRupees = r0;
          st.players[1]!.matchRupees = r1;
          st.players[0]!.goodsTokens = [mkToken('gold', 6)];
          st.players[1]!.goodsTokens = [mkToken('gold', 6)];
        },
        { sealTie: 'all' },
      );
    const a = mk(50, 40);
    expect(a.players.map((p) => p.seals)).toEqual([2, 2]);
    expect(a.phase).toBe('matchOver');
    expect(a.matchWinners).toEqual([0]); // 56 vs 46
    const d = mk(50, 50);
    expect(d.matchWinners).toEqual([0, 1]);
  });
});

describe('views', () => {
  const played = () => {
    // state with tokens in play for visibility tests
    const s = mkState((st) => {
      st.players[0]!.hand = [mkCard('h0', 'diamond'), mkCard('h1', 'diamond'), mkCard('h2', 'leather')];
      st.players[0]!.herd = [mkCard('c0', 'camel'), mkCard('c1', 'camel')];
      st.players[1]!.hand = [mkCard('x0', 'spice')];
      st.players[1]!.herd = [];
      st.discard = [mkCard('d0', 'cloth'), mkCard('d1', 'gold')];
    });
    return s;
  };

  test('own hand is full; opponent gets count + opaque ids only', () => {
    const v = viewFor(played(), 0);
    expect(v.players[0]!.hand).toHaveLength(3);
    expect(v.players[1]!.hand).toBeNull();
    expect(v.players[1]!.handCount).toBe(1);
    expect(v.players[1]!.handIds).toEqual(['x0']);
    // handIds carry no type information — they are plain strings
    expect(typeof v.players[1]!.handIds[0]).toBe('string');
    expect(JSON.stringify(v.players[1])).not.toContain('spice');
  });

  test('deck is never exposed, only its count', () => {
    const v = viewFor(played(), 0);
    expect('deck' in v).toBe(false);
    expect(v.deckCount).toBe(40);
    expect(JSON.stringify(v)).not.toContain('"deck"');
  });

  test('bonus visibility owner/hidden/public', () => {
    const withBonus = (vis: 'owner' | 'hidden' | 'public') =>
      mkState(
        (st) => {
          st.players[0]!.bonusTokens = [mkBonus(3, 2)];
          st.players[1]!.bonusTokens = [mkBonus(4, 6)];
        },
        { rules: { bonusVisibility: vis } },
      );
    const owner = viewFor(withBonus('owner'), 0);
    expect(owner.players[0]!.bonusTokens[0]!.value).toBe(2);
    expect(owner.players[1]!.bonusTokens[0]!.value).toBeNull();
    const hidden = viewFor(withBonus('hidden'), 0);
    expect(hidden.players[0]!.bonusTokens[0]!.value).toBeNull(); // even the owner waits
    const pub = viewFor(withBonus('public'), 1);
    expect(pub.players[0]!.bonusTokens[0]!.value).toBe(2);
    // spectator sees counts, values only when public
    const spec = viewFor(withBonus('owner'), null);
    expect(spec.players[0]!.bonusTokens[0]!.value).toBeNull();
    expect(spec.players[0]!.bonusTokens).toHaveLength(1);
  });

  test('bonus values are revealed once the round is scored', () => {
    const s = mkState((st) => {
      st.players[0]!.bonusTokens = [mkBonus(3, 2)];
      nearTokensEnd(st);
    }, { rules: { bonusVisibility: 'hidden' } });
    const s2 = applyAction(s, 0, { type: 'sell', cardIds: ['h0'] });
    const v = viewFor(s2, 1);
    expect(v.phase).toBe('roundOver');
    expect(v.players[0]!.bonusTokens[0]!.value).toBe(2);
    expect(v.roundResults[0]!.perPlayer[0]!.bonusValues).toEqual([2]);
  });

  test('camelCountPublic off hides herd size but keeps hasCamels', () => {
    const s = mkState(
      (st) => {
        st.players[0]!.herd = [mkCard('c0', 'camel'), mkCard('c1', 'camel')];
      },
      { rules: { camelCountPublic: false } },
    );
    const v = viewFor(s, 1);
    expect(v.players[0]!.herdCount).toBeNull();
    expect(v.players[0]!.hasCamels).toBe(true);
    expect(v.players[0]!.herdIds).toBeNull();
    const own = viewFor(s, 0);
    expect(own.players[0]!.herdCount).toBe(2);
    expect(own.players[0]!.herdIds).toEqual(['c0', 'c1']);
    const empty = mkState((st) => void (st.players[1]!.herd = []), {
      rules: { camelCountPublic: false },
    });
    expect(viewFor(empty, 0).players[1]!.hasCamels).toBe(false);
  });

  test('discardBrowsable off exposes only the top card', () => {
    const s = mkState(
      (st) => {
        st.discard = [mkCard('d0', 'cloth'), mkCard('d1', 'gold')];
      },
      { rules: { discardBrowsable: false } },
    );
    const v = viewFor(s, 0);
    expect(v.discardCount).toBe(2);
    expect(v.discardTop!.id).toBe('d1');
    expect(v.discard.map((c) => c.id)).toEqual(['d1']);
    const open = viewFor(played(), 0);
    expect(open.discard.map((c) => c.id)).toEqual(['d0', 'd1']);
  });

  test('spectator sees public info and opaque hand ids, but no faces', () => {
    const v = viewFor(played(), null);
    expect(v.players[0]!.hand).toBeNull();
    expect(v.players[0]!.handIds).toEqual(['h0', 'h1', 'h2']);
    expect(v.players[0]!.handCount).toBe(3);
    expect(v.market).toHaveLength(5);
    expect(v.players[0]!.goodsTokens).toEqual([]);
  });

  test('sell event bonus value is redacted for others', () => {
    const s = mkState((st) => {
      st.players[0]!.hand = [mkCard('a', 'cloth'), mkCard('b', 'cloth'), mkCard('c', 'cloth')];
    });
    const s2 = applyAction(s, 0, { type: 'sell', cardIds: ['a', 'b', 'c'] });
    const mine = viewFor(s2, 0).lastEvents[0]!;
    const theirs = viewFor(s2, 1).lastEvents[0]!;
    if (mine.type === 'sell' && theirs.type === 'sell') {
      expect(typeof mine.bonus!.value).toBe('number'); // owner sees own value
      expect(theirs.bonus!.value).toBeNull();
    } else throw new Error('expected sell event');
    const hidden = applyAction(
      mkState(
        (st) => {
          st.players[0]!.hand = [mkCard('a', 'cloth'), mkCard('b', 'cloth'), mkCard('c', 'cloth')];
        },
        { rules: { bonusVisibility: 'hidden' } },
      ),
      0,
      { type: 'sell', cardIds: ['a', 'b', 'c'] },
    );
    const selfHidden = viewFor(hidden, 0).lastEvents[0]!;
    if (selfHidden.type === 'sell') expect(selfHidden.bonus!.value).toBeNull();
  });
});

describe('determinism', () => {
  test('same seed + same actions → identical state', () => {
    let a = createMatch({ seed: 99 });
    let b = createMatch({ seed: 99 });
    expect(a).toEqual(b);
    for (let i = 0; i < 30 && a.phase === 'playing'; i++) {
      const act = enumerateActions(actionContextFor(a, a.current))[0]!;
      a = applyAction(a, a.current, act);
      b = applyAction(b, b.current, act);
      expect(a).toEqual(b);
    }
  });

  test('same game words + different id words → same layout, different ids', () => {
    const g = [111, 222, 333, 444];
    const a = createMatch({ seed: [...g, 1, 2, 3, 4] });
    const b = createMatch({ seed: [...g, 5, 6, 7, 8] });
    expect(a.deck.map((c) => c.type)).toEqual(b.deck.map((c) => c.type));
    expect(a.market.map((c) => c.type)).toEqual(b.market.map((c) => c.type));
    expect(a.players.map((p) => p.hand.map((c) => c.type))).toEqual(
      b.players.map((p) => p.hand.map((c) => c.type)),
    );
    expect(a.deck.map((c) => c.id)).not.toEqual(b.deck.map((c) => c.id));
    expect(a.starter).toBe(b.starter);
  });
});

describe('format', () => {
  test('formatTokens', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(7000)).toBe('7K');
    expect(formatTokens(23000)).toBe('23K');
    expect(formatTokens(1500)).toBe('1.5K');
    expect(formatTokens(1250000)).toBe('1.25M');
    expect(formatTokens(1000000)).toBe('1M');
    expect(formatTokens(rupeesToTokens(5))).toBe('5K');
  });
});
