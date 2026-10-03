import { describe, expect, test } from 'vitest';
import {
  applyAction,
  checkAction,
  createMatch,
  mulberry32,
  nextRound,
  viewFor,
  type GameState,
} from '../src/shared/engine';
import {
  actionContextFromView,
  chooseAction,
  suggestAction,
  type Personality,
} from '../src/shared/ai';
import { runMatch, type SeatKind } from './helpers';

const PERSONALITIES: Personality[] = ['cautious', 'balanced', 'aggressive'];

function playBotMatch(seats: [SeatKind, SeatKind], seed: number) {
  return runMatch(seats, seed);
}

describe('legality', () => {
  test('bots always return legal actions', () => {
    let moves = 0;
    for (let m = 0; m < 30; m++) {
      const seats: [Personality, Personality] = [
        PERSONALITIES[m % 3]!,
        PERSONALITIES[(m + 1) % 3]!,
      ];
      let s = createMatch({ seed: 20000 + m });
      const rng = mulberry32(30000 + m);
      let guard = 0;
      while (s.phase !== 'matchOver') {
        if (s.phase === 'roundOver') {
          s = nextRound(s);
          continue;
        }
        const view = viewFor(s, s.current);
        const a = chooseAction(view, seats[s.current]!, rng);
        expect(checkAction(actionContextFromView(view, s.current), a).ok).toBe(true);
        s = applyAction(s, s.current, a);
        moves++;
        if (++guard > 20000) throw new Error('no termination');
      }
    }
    expect(moves).toBeGreaterThan(500);
  }, 120_000);
});

describe('performance', () => {
  test('mean chooseAction time < 50ms', () => {
    const rng = mulberry32(777);
    let s: GameState = createMatch({ seed: 555 });
    let total = 0;
    let n = 0;
    while (s.phase !== 'matchOver' && n < 400) {
      if (s.phase === 'roundOver') {
        s = nextRound(s);
        continue;
      }
      const view = viewFor(s, s.current);
      const t0 = performance.now();
      const a = chooseAction(view, 'balanced', rng);
      total += performance.now() - t0;
      n++;
      s = applyAction(s, s.current, a);
    }
    expect(n).toBeGreaterThan(50);
    expect(total / n).toBeLessThan(50);
  }, 120_000);
});

describe('strength', () => {
  for (const p of PERSONALITIES) {
    test(
      `${p} beats random-move bot ≥80% of 200 matches`,
      () => {
        let wins = 0;
        for (let m = 0; m < 200; m++) {
          const seat = m % 2; // swap seats half the time
          const seats: [SeatKind, SeatKind] = seat === 0 ? [p, 'random'] : ['random', p];
          const { state } = playBotMatch(seats, 40000 + m * 13 + p.length);
          const w = state.matchWinners ?? [];
          if (w.length === 1 && w[0] === seat) wins += 1;
          else if (w.length === 2) wins += 0.5;
        }
        expect(wins / 200).toBeGreaterThanOrEqual(0.8);
      },
      300_000,
    );
    test(
      `${p} beats greedy bot ≥55% of 200 matches`,
      () => {
        let wins = 0;
        for (let m = 0; m < 200; m++) {
          const seat = m % 2;
          const seats: [SeatKind, SeatKind] = seat === 0 ? [p, 'greedy'] : ['greedy', p];
          const { state } = playBotMatch(seats, 90000 + m * 17 + p.length);
          const w = state.matchWinners ?? [];
          if (w.length === 1 && w[0] === seat) wins += 1;
          else if (w.length === 2) wins += 0.5;
        }
        expect(wins / 200).toBeGreaterThanOrEqual(0.55);
      },
      300_000,
    );
  }
});

describe('style', () => {
  test(
    'round-robin personalities differ in style, none dominates',
    () => {
      interface Stats {
        wins: number;
        matches: number;
        sales: number;
        saleCards: number;
        rounds: number;
        herdSum: number;
      }
      const stats: Record<Personality, Stats> = {
        cautious: { wins: 0, matches: 0, sales: 0, saleCards: 0, rounds: 0, herdSum: 0 },
        balanced: { wins: 0, matches: 0, sales: 0, saleCards: 0, rounds: 0, herdSum: 0 },
        aggressive: { wins: 0, matches: 0, sales: 0, saleCards: 0, rounds: 0, herdSum: 0 },
      };
      const pairs: [Personality, Personality][] = [
        ['cautious', 'balanced'],
        ['cautious', 'aggressive'],
        ['balanced', 'aggressive'],
      ];
      let seed = 60000;
      for (const [a, b] of pairs) {
        for (const order of [0, 1] as const) {
          const seats: [SeatKind, SeatKind] = order === 0 ? [a, b] : [b, a];
          for (let m = 0; m < 50; m++) {
            const { state, log } = playBotMatch(seats, seed++);
            const rounds = state.roundResults.length;
            for (const seat of [0, 1] as const) {
              const pers = seats[seat] as Personality;
              const st = stats[pers];
              st.matches += 1;
              st.rounds += rounds;
              for (const r of state.roundResults) st.herdSum += r.perPlayer[seat]!.herd;
              for (const rec of log) {
                if (rec.seat === seat && rec.action.type === 'sell') {
                  st.sales += 1;
                  st.saleCards += rec.action.cardIds.length;
                }
              }
              const w = state.matchWinners ?? [];
              if (w.length === 1 && w[0] === seat) st.wins += 1;
              else if (w.length === 2) st.wins += 0.5;
            }
          }
        }
      }
      const avgSale = (p: Personality) => stats[p].saleCards / stats[p].sales;
      const salesPerRound = (p: Personality) => stats[p].sales / stats[p].rounds;
      const avgHerd = (p: Personality) => stats[p].herdSum / stats[p].rounds;
      const winRate = (p: Personality) => stats[p].wins / stats[p].matches;

      expect(stats.cautious.sales).toBeGreaterThan(0);
      expect(avgSale('aggressive')).toBeGreaterThan(avgSale('balanced'));
      expect(avgSale('balanced')).toBeGreaterThan(avgSale('cautious'));
      expect(avgSale('cautious')).toBeGreaterThanOrEqual(2.0);
      expect(avgSale('balanced')).toBeGreaterThanOrEqual(2.4);
      expect(avgSale('aggressive')).toBeGreaterThanOrEqual(2.8);
      expect(salesPerRound('cautious')).toBeGreaterThan(salesPerRound('aggressive'));
      expect(avgHerd('cautious')).toBeGreaterThan(avgHerd('aggressive'));
      for (const p of PERSONALITIES) {
        expect(winRate(p)).toBeGreaterThanOrEqual(0.36);
        expect(winRate(p)).toBeLessThanOrEqual(0.64);
      }
    },
    600_000,
  );
});
