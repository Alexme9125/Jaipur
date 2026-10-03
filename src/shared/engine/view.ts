import type { RuleOptions } from './rules';
import type {
  BonusTier,
  Card,
  GameEvent,
  GameState,
  Good,
  Phase,
  RoundResult,
  Token,
} from './types';

export interface PublicPlayer {
  /** public for everyone */
  handCount: number;
  /** opaque ids for face-down animation; empty for spectators */
  handIds: string[];
  /** full cards — only for the viewer's own seat */
  hand: Card[] | null;
  /** only for the viewer's own seat */
  herdIds: string[] | null;
  /** null when camelCountPublic is off and this is another player */
  herdCount: number | null;
  hasCamels: boolean;
  goodsTokens: Token[];
  bonusTokens: { id: string; tier: BonusTier; value: number | null }[];
  seals: number;
  matchRupees: number;
}

export interface PlayerView {
  /** seat index, or null for spectators */
  viewer: number | null;
  rules: RuleOptions;
  round: number;
  starter: number;
  current: number;
  turn: number;
  phase: Phase;
  stallCount: number;
  market: Card[];
  deckCount: number;
  discardTop: Card | null;
  discardCount: number;
  /** full pile when discardBrowsable, otherwise just the top card */
  discard: Card[];
  goodsPiles: Record<Good, Token[]>;
  bonusPileCounts: Record<BonusTier, number>;
  players: PublicPlayer[];
  roundResults: RoundResult[];
  lastEvents: GameEvent[];
  matchWinners: number[] | null;
}

export function viewFor(state: GameState, viewer: number | null): PlayerView {
  const s = structuredClone(state);
  const scored = s.phase !== 'playing';
  const seeValues = (seat: number) =>
    scored ||
    s.rules.bonusVisibility === 'public' ||
    (s.rules.bonusVisibility === 'owner' && seat === viewer);

  const players: PublicPlayer[] = s.players.map((p, i) => {
    const isSelf = viewer !== null && i === viewer;
    const herdKnown = isSelf || s.rules.camelCountPublic;
    return {
      handCount: p.hand.length,
      // opaque ids for face-down animation — spectators get them too, faces stay hidden
      handIds: p.hand.map((c) => c.id),
      hand: isSelf ? p.hand : null,
      herdIds: isSelf ? p.herd.map((c) => c.id) : null,
      herdCount: herdKnown ? p.herd.length : null,
      hasCamels: p.herd.length > 0,
      goodsTokens: p.goodsTokens,
      bonusTokens: p.bonusTokens.map((t) => ({
        id: t.id,
        tier: t.tier,
        value: seeValues(i) ? t.value : null,
      })),
      seals: p.seals,
      matchRupees: p.matchRupees,
    };
  });

  const lastEvents = s.lastEvents.map((e) => redactEvent(e, s, viewer, scored));
  const discardTop = s.discard.length > 0 ? s.discard[s.discard.length - 1]! : null;

  const bonusPileCounts = {} as Record<BonusTier, number>;
  for (const t of [3, 4, 5] as BonusTier[]) bonusPileCounts[t] = s.bonusPiles[t].length;

  return {
    viewer,
    rules: s.rules,
    round: s.round,
    starter: s.starter,
    current: s.current,
    turn: s.turn,
    phase: s.phase,
    stallCount: s.stallCount,
    market: s.market,
    deckCount: s.deck.length,
    discardTop,
    discardCount: s.discard.length,
    discard: s.rules.discardBrowsable ? s.discard : discardTop ? [discardTop] : [],
    goodsPiles: s.goodsPiles,
    bonusPileCounts,
    players,
    roundResults: s.roundResults,
    lastEvents,
    matchWinners: s.matchWinners,
  };
}

function redactEvent(
  e: GameEvent,
  s: GameState,
  viewer: number | null,
  scored: boolean,
): GameEvent {
  if (e.type !== 'sell' || e.bonus === null) return e;
  const visible =
    scored ||
    s.rules.bonusVisibility === 'public' ||
    (s.rules.bonusVisibility === 'owner' && e.player === viewer);
  if (visible) return e;
  return { ...e, bonus: { ...e.bonus, value: null } };
}
