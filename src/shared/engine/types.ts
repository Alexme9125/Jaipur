import type { RuleOptions } from './rules';

export type Good = 'diamond' | 'gold' | 'silver' | 'cloth' | 'spice' | 'leather';
export type CardType = Good | 'camel';

export interface Card {
  id: string;
  type: CardType;
}

export interface Token {
  id: string;
  good: Good;
  value: number;
}

export type BonusTier = 3 | 4 | 5;

export interface BonusToken {
  id: string;
  tier: BonusTier;
  value: number;
}

export type Action =
  | { type: 'take'; cardId: string }
  | { type: 'camels' }
  | { type: 'exchange'; take: string[]; give: string[] } // take = market card ids; give = own hand ids and/or own herd camel ids
  | { type: 'sell'; cardIds: string[] };

export interface PlayerState {
  hand: Card[];
  /** camel cards only */
  herd: Card[];
  goodsTokens: Token[];
  bonusTokens: BonusToken[];
  seals: number;
  /** cumulative rupees across rounds */
  matchRupees: number;
}

export type Phase = 'playing' | 'roundOver' | 'matchOver';
export type RoundEndReason = 'tokens' | 'deck' | 'stall';

export interface RoundPlayerResult {
  /** sum of goods token values, in rupees */
  goods: number;
  /** sum of bonus token values, in rupees */
  bonus: number;
  /** camel token: 5 or 0 */
  camel: number;
  total: number;
  bonusCount: number;
  goodsCount: number;
  /** herd size at scoring */
  herd: number;
  /** revealed bonus values */
  bonusValues: number[];
}

export interface RoundResult {
  round: number;
  reason: RoundEndReason;
  sealWinners: number[];
  perPlayer: RoundPlayerResult[];
}

export type GameEvent =
  | { type: 'roundStart'; round: number; starter: number }
  | { type: 'take'; player: number; card: Card; refill: Card[] }
  | { type: 'camels'; player: number; cards: Card[]; refill: Card[] }
  | { type: 'exchange'; player: number; took: Card[]; gave: Card[] }
  | {
      type: 'sell';
      player: number;
      good: Good;
      cards: Card[];
      tokens: Token[];
      bonus: { id: string; tier: BonusTier; value: number | null } | null;
    }
  | { type: 'roundEnd'; reason: RoundEndReason; result: RoundResult }
  | { type: 'matchEnd'; winners: number[] };

export interface GameState {
  rules: RuleOptions;
  /** sfc32 game stream (128-bit state) — drives shuffles, never reaches clients */
  rng: [number, number, number, number];
  /** sfc32 id stream — only mints opaque card/bonus ids */
  idRng: [number, number, number, number];
  players: PlayerState[];
  deck: Card[];
  /** ordered slots; length is MARKET_SIZE while playing, may shrink at round end */
  market: Card[];
  /** last element is the top card */
  discard: Card[];
  /** index 0 of each pile is the top (highest value) */
  goodsPiles: Record<Good, Token[]>;
  bonusPiles: Record<BonusTier, BonusToken[]>;
  /** 1-based round number */
  round: number;
  starter: number;
  current: number;
  /** monotonic, increments every action; used for stale-action rejection */
  turn: number;
  phase: Phase;
  /** consecutive exchanges while the deck is empty */
  stallCount: number;
  roundResults: RoundResult[];
  lastEvents: GameEvent[];
  matchWinners: number[] | null;
}

/** Public-information context shared by legality checks and AI enumeration. */
export interface ActionContext {
  rules: RuleOptions;
  market: Card[];
  hand: Card[];
  herd: Card[];
  goodsPiles: Record<Good, Token[]>;
  deckCount: number;
}
