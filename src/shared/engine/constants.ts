import type { BonusTier, CardType, Good } from './types';

export const GOODS: readonly Good[] = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather'];

/** goods card counts (camels are CAMEL_CARD_COUNT) */
export const CARD_COUNTS: Record<Good, number> = {
  diamond: 6,
  gold: 6,
  silver: 6,
  cloth: 8,
  spice: 8,
  leather: 10,
};

export const CAMEL_CARD_COUNT = 11;
export const TOTAL_CARDS = 55;

/** token values per good; index 0 = top of pile = highest */
export const TOKEN_VALUES: Record<Good, number[]> = {
  diamond: [7, 7, 5, 5, 5],
  gold: [6, 6, 5, 5, 5],
  silver: [5, 5, 5, 5, 5],
  cloth: [5, 3, 3, 2, 2, 1, 1],
  spice: [5, 3, 3, 2, 2, 1, 1],
  leather: [4, 3, 2, 1, 1, 1, 1, 1, 1],
};

/** bonus token values per tier, before shuffling */
export const BONUS_VALUES: Record<BonusTier, number[]> = {
  3: [1, 1, 2, 2, 2, 3, 3],
  4: [4, 4, 5, 5, 6, 6],
  5: [8, 8, 9, 10, 10],
};

export const BONUS_TIERS: readonly BonusTier[] = [3, 4, 5];

/** mean of each tier's values: 14/7, 30/6, 45/5 */
export const TIER_MEAN: Record<BonusTier, number> = { 3: 2, 4: 5, 5: 9 };

export const PRECIOUS: readonly Good[] = ['diamond', 'gold', 'silver'];

export const HAND_LIMIT = 7;
export const MARKET_SIZE = 5;
export const CAMEL_BONUS = 5;
export const SEALS_TO_WIN = 2;
export const MAX_ROUNDS = 5;
export const STALL_LIMIT = 6;
export const TOKENS_PER_RUPEE = 1000;
export const PLAYER_COUNT = 2;
export const INITIAL_DEAL = 5;
export const MARKET_CAMELS = 3;
export const MARKET_REFILL_SETUP = 2;

export const GOODS_META: Record<CardType, { zh: string; en: string }> = {
  diamond: { zh: '钻石', en: 'Diamond' },
  gold: { zh: '黄金', en: 'Gold' },
  silver: { zh: '白银', en: 'Silver' },
  cloth: { zh: '布匹', en: 'Cloth' },
  spice: { zh: '香料', en: 'Spice' },
  leather: { zh: '皮革', en: 'Leather' },
  camel: { zh: '骆驼', en: 'Camel' },
};
