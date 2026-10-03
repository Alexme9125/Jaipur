import {
  applyAction,
  checkAction,
  actionContextFor,
  createMatch,
  mulberry32,
  nextRound as engineNextRound,
  viewFor,
} from '@shared/engine';
import { rupeesToTokens } from '@shared/format';
import type { RuleOptions } from '@shared/engine';
import type { Action, GameState } from '@shared/engine/types';
import { chooseAction, suggestAction, type Personality } from '@shared/ai';
import { describeEvent } from './describe';
import type { DriverSnapshot, GameDriver, LogEntry } from './driver';
import { loadProfile, saveProfile, PVE_SAVE_KEY } from './profile';

export interface LocalDriverOptions {
  personality: Personality;
  rules?: Partial<RuleOptions>;
  names: [string, string];
  seed?: number | number[];
}

export interface SavedGame {
  v: 1;
  state: GameState;
  log: LogEntry[];
  names: [string, string];
  personality: Personality;
}

export function loadSavedGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(PVE_SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedGame;
    if (s.v !== 1 || !s.state || s.state.phase === 'matchOver') return null;
    return s;
  } catch {
    return null;
  }
}

function freshSeed(): number[] {
  return Array.from(crypto.getRandomValues(new Uint32Array(8)));
}

function devSeed(): number | undefined {
  if (!import.meta.env.DEV) return undefined;
  const q = new URLSearchParams(location.search).get('seed');
  return q !== null ? Number(q) : undefined;
}

function devAutoplay(): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(location.search).get('autoplay') === '1';
}

const BOT_NAMES: Record<Personality, string> = {
  cautious: '米拉',
  balanced: '阿尔琼',
  aggressive: '拉维',
};

export function botNameFor(p: Personality): string {
  return BOT_NAMES[p];
}

export class LocalDriver implements GameDriver {
  private state: GameState;
  private listeners = new Set<(s: DriverSnapshot) => void>();
  private log: LogEntry[] = [];
  private logId = 0;
  private names: [string, string];
  private personality: Personality;
  private rules?: Partial<RuleOptions>;
  private botRng: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastActionAt = 0;
  private autoplay = devAutoplay();
  private thinkingFlag = false;
  private disposed = false;

  constructor(opts: LocalDriverOptions, resume?: SavedGame) {
    this.personality = opts.personality;
    this.rules = opts.rules;
    this.names = opts.names;
    this.botRng = mulberry32(freshSeed()[0]!);
    if (resume) {
      this.state = resume.state;
      this.log = resume.log;
      this.logId = resume.log.length;
      this.names = resume.names;
      this.personality = resume.personality;
      this.rules = resume.state.rules;
    } else {
      const seed = devSeed() ?? opts.seed ?? freshSeed();
      this.state = createMatch({ seed, rules: opts.rules });
      this.recordEvents();
    }
    this.kick();
  }

  /* ---------- pub/sub ---------- */

  subscribe(cb: (s: DriverSnapshot) => void): () => void {
    this.listeners.add(cb);
    cb(this.snapshot());
    return () => this.listeners.delete(cb);
  }

  private snapshot(): DriverSnapshot {
    return {
      view: viewFor(this.state, this.autoplay ? 0 : 0),
      log: this.log,
      names: this.names,
      personalities: [null, this.personality],
      thinking: this.thinkingFlag,
    };
  }

  private emit(): void {
    const s = this.snapshot();
    for (const cb of this.listeners) cb(s);
  }

  /* ---------- actions ---------- */

  act(a: Action): { ok: true } | { ok: false; reason: string } {
    if (this.state.phase !== 'playing') return { ok: false, reason: '本轮已结束' };
    if (this.state.current !== 0) return { ok: false, reason: '还没轮到你行动' };
    const chk = checkAction(actionContextFor(this.state, 0), a);
    if (!chk.ok) return { ok: false, reason: chk.reason };
    this.apply(0, a);
    return { ok: true };
  }

  private apply(seat: number, a: Action): void {
    this.state = applyAction(this.state, seat, a);
    this.lastActionAt = Date.now();
    this.recordEvents();
    this.persist();
    this.finishIfMatchOver();
    this.kick();
    this.emit();
  }

  private applyBot(): void {
    if (this.state.phase !== 'playing' || this.state.current !== 1) return;
    const action = chooseAction(viewFor(this.state, 1), this.personality, this.botRng);
    this.apply(1, action);
  }

  private applyAuto(): void {
    if (this.state.phase !== 'playing' || this.state.current !== 0) return;
    const action = suggestAction(viewFor(this.state, 0));
    this.apply(0, action);
  }

  /* ---------- turn scheduling ---------- */

  private setThinking(on: boolean): void {
    if (this.thinkingFlag === on) return;
    this.thinkingFlag = on;
    this.emit();
  }

  private kick(): void {
    if (this.disposed || this.state.phase !== 'playing') {
      this.setThinking(false);
      return;
    }
    if (this.timer !== null) return;
    if (this.state.current === 1) {
      this.setThinking(true);
      const extra = Date.now() - this.lastActionAt < 700 ? 600 : 0;
      const delay = 700 + this.botRng() * 500 + extra;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.setThinking(false);
        this.applyBot();
      }, delay);
    } else if (this.autoplay) {
      this.setThinking(true);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.applyAuto();
      }, 350);
    } else {
      this.setThinking(false);
    }
  }

  /* ---------- round / match flow ---------- */

  nextRound(): void {
    if (this.state.phase !== 'roundOver' || this.state.matchWinners) return;
    this.state = engineNextRound(this.state);
    this.recordEvents();
    this.persist();
    this.kick();
    this.emit();
  }

  rematch(): void {
    this.clearTimer();
    const seed = devSeed() ?? freshSeed();
    this.state = createMatch({ seed, rules: this.rules });
    this.log = [];
    this.logId = 0;
    this.recordEvents();
    this.persist();
    this.kick();
    this.emit();
  }

  hint(): Action {
    return suggestAction(viewFor(this.state, 0));
  }

  /* ---------- bookkeeping ---------- */

  private recordEvents(): void {
    for (const e of this.state.lastEvents) {
      const d = describeEvent(e, this.names);
      if (d) this.log.push({ id: ++this.logId, round: this.state.round, seat: d.seat, text: d.text });
    }
    if (this.log.length > 300) this.log = this.log.slice(-300);
  }

  private finishIfMatchOver(): void {
    if (this.state.phase !== 'matchOver') return;
    try {
      localStorage.removeItem(PVE_SAVE_KEY);
    } catch {
      /* ignore */
    }
    const profile = loadProfile();
    profile.matches += 1;
    const w = this.state.matchWinners ?? [];
    if (w.length === 1 && w[0] === 0) profile.wins += 1;
    else if (w.length === 2) profile.wins += 0.5;
    profile.lifetimeTokens += rupeesToTokens(this.state.players[0]!.matchRupees);
    saveProfile(profile);
  }

  private persist(): void {
    if (this.state.phase === 'matchOver') return;
    try {
      const save: SavedGame = {
        v: 1,
        state: this.state,
        log: this.log,
        names: this.names,
        personality: this.personality,
      };
      localStorage.setItem(PVE_SAVE_KEY, JSON.stringify(save));
    } catch {
      /* storage full/blocked — playing without save */
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.listeners.clear();
  }
}
