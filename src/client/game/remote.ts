import type { Action } from '@shared/engine/types';
import type { PlayerView } from '@shared/engine/view';
import type { RuleOptions } from '@shared/engine/rules';
import { checkAction } from '@shared/engine/actions';
import { actionContextFromView } from '@shared/ai';
import { rupeesToTokens } from '@shared/format';
import type { ClientMsg, ServerMsg, RoomPublic, LogLine } from '@shared/protocol';
import type { DriverSnapshot, GameDriver, LogEntry } from './driver';
import { loadProfile, saveProfile } from './profile';
import { createClientId } from './identity';

export interface RemoteMeta {
  room: RoomPublic | null;
  ended: { reason: 'left' | 'timeout'; name: string } | null;
  connected: boolean;
  /** 'room' once a room msg arrived */
  phase: 'connecting' | 'room';
}

const AUTO_ROUND_MS = 20_000;

export class RemoteDriver implements GameDriver {
  private ws: WebSocket | null = null;
  private listeners = new Set<(s: DriverSnapshot) => void>();
  private metaListeners = new Set<(m: RemoteMeta) => void>();
  private clientId: string;
  private name: string;
  private roomCode: string | null;
  private wantCreate: boolean;

  private room: RoomPublic | null = null;
  private view: PlayerView | null = null;
  private log: LogEntry[] = [];
  private names: [string, string] = ['玩家 1', '玩家 2'];
  private ended: RemoteMeta['ended'] = null;
  private connected = false;
  private netError: string | null = null;

  private disposed = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private profileRecorded = false;

  constructor(opts: { code: string | null; create?: boolean }) {
    this.clientId = createClientId();
    this.name = loadProfile().name;
    this.roomCode = opts.code;
    this.wantCreate = opts.create ?? false;
    this.connect();
  }

  private wsUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  private connect() {
    if (this.disposed) return;
    const ws = new WebSocket(this.wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      this.send({ t: 'hello', clientId: this.clientId, name: this.name });
      // rejoin restores our seat/spectator role on the server side
      if (this.roomCode) this.send({ t: 'join', code: this.roomCode });
      else if (this.wantCreate) this.send({ t: 'create' });
      this.emitMeta();
    };
    ws.onmessage = (e) => this.onMsg(JSON.parse(e.data as string) as ServerMsg);
    ws.onclose = () => {
      this.connected = false;
      this.emitMeta();
      if (this.disposed) return;
      const wait = Math.min(4000, 500 * 2 ** this.retry++);
      this.retryTimer = setTimeout(() => this.connect(), wait);
    };
    ws.onerror = () => ws.close();
  }

  private send(m: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private onMsg(m: ServerMsg) {
    switch (m.t) {
      case 'room':
        this.room = m.room;
        if (m.room.status === 'playing') {
          this.ended = null;
          this.profileRecorded = false;
        }
        if (this.roomCode !== m.room.code) {
          this.roomCode = m.room.code;
          history.replaceState(null, '', `/r/${m.room.code}`);
        }
        this.emitMeta();
        this.emit();
        break;
      case 'game':
        this.view = m.view;
        this.log = m.log as LogEntry[];
        this.names = m.names;
        this.netError = null;
        this.recordMatchOver();
        this.emit();
        break;
      case 'ended':
        this.ended = { reason: m.reason, name: m.name };
        this.emitMeta();
        this.emit();
        break;
      case 'error':
        this.netError = m.message;
        this.emit();
        break;
      default:
        break;
    }
  }

  /* ---------- GameDriver ---------- */

  subscribe(cb: (s: DriverSnapshot) => void): () => void {
    this.listeners.add(cb);
    if (this.view) cb(this.snapshot());
    return () => this.listeners.delete(cb);
  }

  subscribeMeta(cb: (m: RemoteMeta) => void): () => void {
    this.metaListeners.add(cb);
    cb(this.meta());
    return () => this.metaListeners.delete(cb);
  }

  currentMeta(): RemoteMeta {
    return this.meta();
  }

  private meta(): RemoteMeta {
    return {
      room: this.room,
      ended: this.ended,
      connected: this.connected,
      phase: this.room ? 'room' : 'connecting',
    };
  }

  private seatOf(): number | null {
    const y = this.room?.you;
    return y && y.role === 'seat' ? y.seat : null;
  }

  private snapshot(): DriverSnapshot {
    const view = this.view!;
    const seat = view.viewer;
    const playing = view.phase === 'playing';
    const snap: DriverSnapshot = {
      view,
      log: this.log,
      names: this.names,
      personalities: [null, null],
      thinking: playing && seat !== null && view.current !== seat,
      seat,
      oppReconnectDeadline: null,
      ready: this.room?.ready,
      autoRoundMs: AUTO_ROUND_MS,
    };
    if (this.room?.turnDeadline && this.room.rules.turnTimer > 0) {
      snap.turnDeadline = this.room.turnDeadline;
      snap.turnTimerMs = this.room.rules.turnTimer * 1000;
    }
    if (this.room) {
      const oppSeat = seat === null ? null : (1 - seat) as 0 | 1;
      if (oppSeat !== null) {
        const opp = this.room.seats[oppSeat];
        if (opp && !opp.connected && opp.reconnectDeadline)
          snap.oppReconnectDeadline = opp.reconnectDeadline;
      }
    }
    if (this.netError) snap.netError = this.netError;
    return snap;
  }

  private emit() {
    if (!this.view) return;
    const s = this.snapshot();
    for (const cb of this.listeners) cb(s);
  }

  private emitMeta() {
    const m = this.meta();
    for (const cb of this.metaListeners) cb(m);
  }

  act(a: Action): { ok: true } | { ok: false; reason: string } {
    const view = this.view;
    const seat = this.seatOf();
    if (!view || seat === null) return { ok: false, reason: '你还不在座位上' };
    if (view.phase !== 'playing') return { ok: false, reason: '本轮已结束' };
    if (view.current !== seat) return { ok: false, reason: '还没轮到你行动' };
    const chk = checkAction(actionContextFromView(view, seat), a);
    if (!chk.ok) return { ok: false, reason: chk.reason };
    this.netError = null;
    this.send({ t: 'act', action: a, turn: view.turn });
    return { ok: true };
  }

  nextRound(): void {
    this.send({ t: 'ready' });
  }

  rematch(): void {
    this.send({ t: 'start' });
  }

  /* ---------- room controls ---------- */

  sit(seat: 0 | 1) {
    this.send({ t: 'sit', seat });
  }
  stand() {
    this.send({ t: 'stand' });
  }
  setRules(rules: RuleOptions) {
    this.send({ t: 'setRules', rules });
  }
  start() {
    this.send({ t: 'start' });
  }
  leave() {
    this.send({ t: 'leave' });
  }

  /* ---------- profile bookkeeping ---------- */

  private recordMatchOver() {
    const v = this.view;
    if (!v || v.phase !== 'matchOver' || this.profileRecorded) return;
    const seat = v.viewer;
    if (seat === null) return; // spectators don't update
    this.profileRecorded = true;
    const profile = loadProfile();
    profile.matches += 1;
    const w = v.matchWinners ?? [];
    if (w.length === 1 && w[0] === seat) profile.wins += 1;
    else if (w.length === 2) profile.wins += 0.5;
    profile.lifetimeTokens += rupeesToTokens(v.players[seat]!.matchRupees);
    saveProfile(profile);
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.listeners.clear();
    this.metaListeners.clear();
  }
}
