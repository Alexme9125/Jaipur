import {
  applyAction,
  createMatch,
  enumerateActions,
  mulberry32,
  nextRound,
  viewFor,
  actionContextFor,
  GOODS,
  PRECIOUS,
  type Action,
  type BonusTier,
  type BonusToken,
  type Card,
  type CardType,
  type GameState,
  type Good,
  type RuleOptions,
  type Token,
} from '../src/shared/engine';
import { actionContextFromView, chooseAction, type Personality } from '../src/shared/ai';
import type { PlayerView } from '../src/shared/engine';

export const mkCard = (id: string, type: CardType): Card => ({ id, type });

export const mkToken = (good: Good, value: number, i = 0): Token => ({
  id: `${good}-t${i}`,
  good,
  value,
});

export const mkBonus = (tier: BonusTier, value: number, i = 0): BonusToken => ({
  id: `b${tier}-${i}`,
  tier,
  value,
});

/** Fresh match, then mutate the plain-JSON state in place for scenario setup. */
export function mkState(
  mut?: (s: GameState) => void,
  opts?: { seed?: number; rules?: Partial<RuleOptions>; starter?: number },
): GameState {
  const s = createMatch({ seed: opts?.seed ?? 1, rules: opts?.rules, starter: opts?.starter ?? 0 });
  mut?.(s);
  return s;
}

export function randomAction(ctx: ReturnType<typeof actionContextFor>, rng: () => number): Action {
  const actions = enumerateActions(ctx);
  return actions[Math.floor(rng() * actions.length)]!;
}

export interface ActionRecord {
  seat: number;
  round: number;
  action: Action;
}

export interface MatchRun {
  state: GameState;
  log: ActionRecord[];
}

export type SeatKind = 'random' | 'greedy' | Personality;

/**
 * Plays a full match. 'random' seats act on the true state context;
 * personality seats act on their redacted PlayerView (the real interface).
 */
export function runMatch(
  seats: [SeatKind, SeatKind],
  seed: number,
  rules?: Partial<RuleOptions>,
): MatchRun {
  let s = createMatch({ seed, rules });
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const log: ActionRecord[] = [];
  let guard = 0;
  while (s.phase !== 'matchOver') {
    if (s.phase === 'roundOver') {
      s = nextRound(s);
      continue;
    }
    const seat = s.current;
    const kind = seats[seat]!;
    let action: Action;
    if (kind === 'random') {
      action = randomAction(actionContextFor(s, seat), rng);
    } else {
      const view = viewFor(s, seat);
      action = kind === 'greedy' ? greedyAction(view) : chooseAction(view, kind, rng);
    }
    log.push({ seat, round: s.round, action });
    s = applyAction(s, seat, action);
    if (++guard > 20000) throw new Error('match did not terminate');
  }
  return { state: s, log };
}

export function randomActionFromView(view: PlayerView, rng: () => number): Action {
  const ctx = actionContextFromView(view, view.viewer!);
  const actions = enumerateActions(ctx);
  return actions[Math.floor(rng() * actions.length)]!;
}

/**
 * Greedy baseline: sell a ≥3 set or a ≥2 precious set (largest, then highest
 * top token); else take the best market good; else camels; else largest sale.
 */
export function greedyAction(view: PlayerView): Action {
  const me = view.players[view.viewer!]!;
  const hand = me.hand ?? [];
  const topOf = (g: Good) => view.goodsPiles[g][0]?.value ?? 0;

  let bestSell: Action | null = null;
  let bestKey = -1;
  for (const g of GOODS) {
    const cards = hand.filter((c) => c.type === g);
    const qualifies = cards.length >= 3 || (PRECIOUS.includes(g) && cards.length >= 2);
    if (!qualifies) continue;
    const key = cards.length * 100 + topOf(g);
    if (key > bestKey) {
      bestKey = key;
      bestSell = { type: 'sell', cardIds: cards.map((c) => c.id) };
    }
  }
  if (bestSell) return bestSell;

  if (hand.length < 7) {
    let take: Card | null = null;
    let tv = -1;
    for (const c of view.market) {
      if (c.type === 'camel') continue;
      const v = topOf(c.type);
      if (v > tv) {
        tv = v;
        take = c;
      }
    }
    if (take) return { type: 'take', cardId: take.id };
  }

  if (view.market.some((c) => c.type === 'camel')) return { type: 'camels' };

  const ctx = actionContextFromView(view, view.viewer!);
  const actions = enumerateActions(ctx);
  const sells = actions.filter(
    (a): a is Extract<Action, { type: 'sell' }> => a.type === 'sell',
  );
  sells.sort((x, y) => y.cardIds.length - x.cardIds.length);
  return sells[0] ?? actions[0]!;
}
