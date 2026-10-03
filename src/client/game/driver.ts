import type { Personality } from '@shared/ai';
import type { Action } from '@shared/engine/types';
import type { PlayerView } from '@shared/engine/view';

export interface LogEntry {
  id: number;
  round: number;
  /** seat that acted, or null for system lines (round/match boundaries) */
  seat: number | null;
  text: string;
}

export interface DriverSnapshot {
  view: PlayerView;
  log: LogEntry[];
  names: [string, string];
  personalities: (Personality | null)[];
  thinking: boolean;
  /** pvp extras — absent in LocalDriver */
  seat?: number | null;
  turnDeadline?: number;
  turnTimerMs?: number;
  oppReconnectDeadline?: number | null;
  ready?: [boolean, boolean];
  autoRoundMs?: number;
  /** last server-side rejection, surfaced in the action bar */
  netError?: string;
}

/**
 * The only contract the UI speaks. LocalDriver implements it for PVE;
 * a remote driver (websocket) plugs in here later with the same surface.
 */
export interface GameDriver {
  subscribe(cb: (s: DriverSnapshot) => void): () => void;
  act(a: Action): { ok: true } | { ok: false; reason: string };
  nextRound(): void;
  rematch(): void;
  hint?(): Action;
  dispose(): void;
}
