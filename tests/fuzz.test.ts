import { describe, expect, test } from 'vitest';
import {
  actionContextFor,
  applyAction,
  createMatch,
  enumerateActions,
  mulberry32,
  nextRound,
  type GameState,
} from '../src/shared/engine';

function assertInvariants(s: GameState): void {
  const cards =
    s.deck.length +
    s.market.length +
    s.discard.length +
    s.players.reduce((n, p) => n + p.hand.length + p.herd.length, 0);
  expect(cards).toBe(55);

  const goodsTokens =
    Object.values(s.goodsPiles).reduce((n, p) => n + p.length, 0) +
    s.players.reduce((n, p) => n + p.goodsTokens.length, 0);
  expect(goodsTokens).toBe(38);

  const bonusTokens =
    Object.values(s.bonusPiles).reduce((n, p) => n + p.length, 0) +
    s.players.reduce((n, p) => n + p.bonusTokens.length, 0);
  expect(bonusTokens).toBe(18);

  for (const p of s.players) expect(p.hand.length).toBeLessThanOrEqual(7);

  if (s.phase === 'playing') {
    expect(s.market).toHaveLength(5);
    const actions = enumerateActions(actionContextFor(s, s.current));
    expect(actions.length).toBeGreaterThan(0);
  }
}

describe('fuzz', () => {
  test(
    '300 random matches: conservation, hand limit, market shape, termination',
    () => {
      for (let m = 0; m < 300; m++) {
        let s = createMatch({ seed: 1000 + m });
        const rng = mulberry32(5000 + m);
        let guard = 0;
        while (s.phase !== 'matchOver') {
          assertInvariants(s);
          if (s.phase === 'roundOver') {
            s = nextRound(s);
            continue;
          }
          const acts = enumerateActions(actionContextFor(s, s.current));
          s = applyAction(s, s.current, acts[Math.floor(rng() * acts.length)]!);
          if (++guard > 20000) throw new Error(`match ${m} did not terminate`);
        }
        assertInvariants(s);
        expect(s.matchWinners).not.toBeNull();
      }
    },
    300_000,
  );
});
