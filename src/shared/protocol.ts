/**
 * WebSocket room protocol — shared verbatim by server and client.
 * The wire never carries GameState or another client's clientId; every
 * client receives viewFor(state, theirSeat | null) instead.
 */
import type { Action } from './engine/types';
import type { PlayerView } from './engine/view';
import type { RuleOptions } from './engine/rules';

/** one described log line (same shape as the client's LogEntry) */
export interface LogLine {
  id: number;
  round: number;
  seat: number | null;
  text: string;
}

export type ClientMsg =
  | { t: 'hello'; clientId: string; name: string }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'sit'; seat: 0 | 1 }
  | { t: 'stand' }
  | { t: 'setRules'; rules: RuleOptions }
  | { t: 'start' }
  | { t: 'act'; action: Action; turn: number }
  | { t: 'ready' }
  | { t: 'ping' };

export interface SeatPublic {
  name: string;
  connected: boolean;
  /** epoch ms; present while a seated player is disconnected */
  reconnectDeadline?: number;
  isHost: boolean;
  isYou: boolean;
}

export type YouRole = { role: 'seat'; seat: 0 | 1 } | { role: 'spectator' };

export interface RoomPublic {
  code: string;
  status: 'waiting' | 'playing';
  seats: [SeatPublic | null, SeatPublic | null];
  spectators: { name: string; isYou: boolean }[];
  you: YouRole;
  isHost: boolean;
  rules: RuleOptions;
  ready: [boolean, boolean];
  /** epoch ms for the current turn, only when turnTimer is on */
  turnDeadline?: number;
  lastMatch?: { winners: number[]; names: [string, string] };
}

export type ServerMsg =
  | { t: 'welcome'; clientId: string }
  | { t: 'room'; room: RoomPublic }
  | { t: 'game'; view: PlayerView; log: LogLine[]; names: [string, string] }
  | { t: 'error'; code: string; message: string }
  | { t: 'ended'; reason: 'left' | 'timeout'; name: string }
  | { t: 'pong' };

export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LEN = 5;
export const MAX_ROOMS = 1000;
export const MAX_SPECTATORS = 50;
export const MAX_PAYLOAD = 16 * 1024;
export const MAX_MSG_PER_SEC = 30;
export const NAME_MAX = 16;
