import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server/index';
import type { ClientMsg, ServerMsg, RoomPublic } from '../src/shared/protocol';
import type { PlayerView } from '../src/shared/engine/view';
import type { Action } from '../src/shared/engine/types';
import { enumerateActions } from '../src/shared/engine/actions';
import { actionContextFromView } from '../src/shared/ai/index';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const allClients = new Set<C>();

class C {
  ws!: WebSocket;
  msgs: ServerMsg[] = [];
  name: string;
  clientId: string;
  private waiters: { pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }[] = [];

  constructor(name: string, clientId: string) {
    this.name = name;
    // S3 requires hello.clientId ∈ [16,64] — pad short test ids
    this.clientId = clientId.padEnd(16, 'x');
  }

  static async connect(port: number, name: string, clientId: string): Promise<C> {
    const c = new C(name, clientId);
    c.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((res, rej) => {
      c.ws.once('open', res);
      c.ws.once('error', rej);
    });
    c.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      c.msgs.push(m);
      for (let i = c.waiters.length - 1; i >= 0; i--) {
        if (c.waiters[i]!.pred(m)) {
          c.waiters[i]!.res(m);
          c.waiters.splice(i, 1);
        }
      }
    });
    c.send({ t: 'hello', clientId: c.clientId, name });
    await c.waitFor((m) => m.t === 'welcome');
    allClients.add(c);
    return c;
  }

  send(m: ClientMsg) {
    this.ws.send(JSON.stringify(m));
  }

  async waitFor(pred: (m: ServerMsg) => boolean, ms = 6000): Promise<ServerMsg> {
    const found = this.msgs.find(pred);
    if (found) return found;
    return new Promise((res, rej) => {
      const w = { pred, res };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          const last = this.msgs[this.msgs.length - 1];
          const lastErr = [...this.msgs].reverse().find((m) => m.t === 'error');
          const errInfo =
            lastErr && lastErr.t === 'error' ? ` err=${lastErr.code}:${lastErr.message}` : '';
          const info =
            last?.t === 'game'
              ? `game turn=${last.view.turn} phase=${last.view.phase} round=${last.view.round} cur=${last.view.current}`
              : last?.t === 'room'
                ? `room status=${last.room.status} ready=${last.room.ready}`
                : (last?.t ?? 'none');
          rej(
            new Error(
              `timeout waiting for message (${this.name} last=${info}${errInfo} n=${this.msgs.length})`,
            ),
          );
        }
      }, ms);
    });
  }

  lastRoom(): RoomPublic {
    const m = [...this.msgs].reverse().find((x) => x.t === 'room');
    if (!m || m.t !== 'room') throw new Error('no room msg');
    return m.room;
  }

  lastGame(): { view: PlayerView; names: [string, string] } {
    const m = [...this.msgs].reverse().find((x) => x.t === 'game');
    if (!m || m.t !== 'game') throw new Error('no game msg');
    return m;
  }

  close() {
    this.ws.close();
  }
}

/** a legal action for the current seat (first enumerated) */
function anyAction(view: PlayerView): Action {
  return enumerateActions(actionContextFromView(view, view.current))[0]!;
}

async function startRoom(port: number): Promise<{ host: C; guest: C; code: string }> {
  const host = await C.connect(port, '房主', 'host-id');
  host.send({ t: 'create' });
  const rm = (await host.waitFor((m) => m.t === 'room')) as Extract<ServerMsg, { t: 'room' }>;
  const code = rm.room.code;
  const guest = await C.connect(port, '客人', 'guest-id');
  guest.send({ t: 'join', code });
  await guest.waitFor((m) => m.t === 'room' && m.room.seats[1]?.isYou === true);
  host.send({ t: 'start' });
  await host.waitFor((m) => m.t === 'game');
  await guest.waitFor((m) => m.t === 'game');
  return { host, guest, code };
}

describe('pvp server', () => {
  let server: HttpServer;
  let port: number;

  beforeAll(async () => {
    server = createServer({
      port: 0,
      host: '127.0.0.1',
      graceMs: 250,
      roundAutoMs: 400,
      timerScale: 0.008,
      ratePerSec: 0,
    });
    await new Promise<void>((res) => server.once('listening', res));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const c of allClients) c.ws.terminate();
    allClients.clear();
    await sleep(50);
    await new Promise<void>((res) => server.close(() => res()));
  });

  it('create → join seats → third client spectates; spectator view leaks nothing', async () => {
    const host = await C.connect(port, '甲', 'c1');
    host.send({ t: 'create' });
    const rm = (await host.waitFor((m) => m.t === 'room')) as Extract<ServerMsg, { t: 'room' }>;
    expect(rm.room.status).toBe('waiting');
    expect(rm.room.seats[0]?.isYou).toBe(true);
    expect(rm.room.seats[0]?.isHost).toBe(true);

    const guest = await C.connect(port, '乙', 'c2');
    guest.send({ t: 'join', code: rm.room.code });
    await guest.waitFor((m) => m.t === 'room' && m.room.seats[1]?.isYou === true);

    const spec = await C.connect(port, '丙', 'c3');
    spec.send({ t: 'join', code: rm.room.code });
    await spec.waitFor(
      (m) => m.t === 'room' && m.room.spectators.some((s) => s.isYou),
    );
    expect(spec.lastRoom().you.role).toBe('spectator');

    host.send({ t: 'start' });
    const gm = (await spec.waitFor((m) => m.t === 'game')) as Extract<ServerMsg, { t: 'game' }>;
    expect(gm.view.viewer).toBe(null);
    for (const p of gm.view.players) expect(p.hand).toBeNull();

    // leak check: nothing serialized may carry the deck, and a client only ever
    // sees its own hand's card types
    for (const c of [host, guest, spec]) {
      for (const m of c.msgs) {
        const s = JSON.stringify(m);
        expect(s.includes('"deck"')).toBe(false);
      }
      for (const m of c.msgs) {
        if (m.t !== 'game') continue;
        const v = m.view;
        for (let i = 0; i < 2; i++) {
          if (i !== v.viewer) expect(v.players[i]!.hand).toBeNull();
          else if (v.viewer !== null) expect(v.players[i]!.hand).not.toBeNull();
        }
      }
    }
    host.close();
    guest.close();
    spec.close();
    await sleep(400); // let grace elapse, rooms cleaned
  });

  it('join rejects unknown code', async () => {
    const c = await C.connect(port, '丁', 'c4');
    c.send({ t: 'join', code: 'ZZZZZ' });
    const e = (await c.waitFor((m) => m.t === 'error')) as Extract<ServerMsg, { t: 'error' }>;
    expect(e.message).toBe('房间不存在，检查一下房间码');
    c.close();
    await sleep(350);
  });

  it('stand/sit while waiting; rejected while playing; start permissions', async () => {
    const host = await C.connect(port, 'A', 'c10');
    host.send({ t: 'create' });
    const rm = (await host.waitFor((m) => m.t === 'room')) as Extract<ServerMsg, { t: 'room' }>;

    // start with empty seat fails
    host.send({ t: 'start' });
    let e = (await host.waitFor((m) => m.t === 'error')) as Extract<ServerMsg, { t: 'error' }>;
    expect(e.message).toBe('两个座位都坐满后才能开局');

    const guest = await C.connect(port, 'B', 'c11');
    guest.send({ t: 'join', code: rm.room.code });
    await guest.waitFor((m) => m.t === 'room' && m.room.seats[1]?.isYou === true);

    // guest cannot start
    guest.send({ t: 'start' });
    e = (await guest.waitFor((m) => m.t === 'error')) as Extract<ServerMsg, { t: 'error' }>;
    expect(e.message).toBe('只有房主可以开局');

    // guest stands then sits in the other seat… seat 0 is host's, so sit back on 1
    guest.send({ t: 'stand' });
    await guest.waitFor((m) => m.t === 'room' && m.room.you.role === 'spectator');
    guest.send({ t: 'sit', seat: 1 });
    await guest.waitFor((m) => m.t === 'room' && m.room.you.role === 'seat');

    host.send({ t: 'start' });
    await host.waitFor((m) => m.t === 'game');

    // cannot move seats mid-game
    guest.send({ t: 'stand' });
    e = (await guest.waitFor((m) => m.t === 'error' && m.code === 'playing')) as Extract<
      ServerMsg,
      { t: 'error' }
    >;
    expect(e.message).toBe('对局中不能换座');

    // leave mid-game ends it for everyone
    guest.send({ t: 'leave' });
    const end = (await host.waitFor((m) => m.t === 'ended')) as Extract<
      ServerMsg,
      { t: 'ended' }
    >;
    expect(end.reason).toBe('left');
    expect(end.name).toBe('B');
    await host.waitFor((m) => m.t === 'room' && m.room.status === 'waiting');
    // host became alone — still host
    expect(host.lastRoom().isHost).toBe(true);
    host.close();
    guest.close();
    await sleep(350);
  });

  it('wrong-turn and stale-turn rejection', async () => {
    const { host, guest } = await startRoom(port);
    let v = host.lastGame().view;
    const meC = v.current === 0 ? host : guest;
    const oppC = v.current === 0 ? guest : host;

    // wrong seat
    oppC.send({ t: 'act', action: anyAction(oppC.lastGame().view), turn: v.turn });
    let e = (await oppC.waitFor((m) => m.t === 'error' && m.code === 'not_turn')) as Extract<
      ServerMsg,
      { t: 'error' }
    >;
    expect(e.message).toBe('还没轮到你行动');

    // stale turn
    meC.send({ t: 'act', action: anyAction(meC.lastGame().view), turn: v.turn + 1 });
    e = (await meC.waitFor((m) => m.t === 'error' && m.code === 'stale')) as Extract<
      ServerMsg,
      { t: 'error' }
    >;
    expect(e.message).toBe('这一步已过期，请按最新局面操作');

    // legal act advances the turn
    meC.send({ t: 'act', action: anyAction(meC.lastGame().view), turn: v.turn });
    await meC.waitFor(
      (m) => m.t === 'game' && m.view.turn === v.turn + 1,
    );
    host.close();
    guest.close();
    await sleep(400); // grace → aborts game, room dropped
  });

  it('disconnect inside grace resumes; reconnects keep the seat', async () => {
    const { host, guest, code } = await startRoom(port);
    const deadline = Date.now() + 250;
    guest.close();
    // host sees guest marked offline with a reconnect deadline
    await host.waitFor(
      (m) => m.t === 'room' && m.room.seats.some((s) => s && !s.connected && !!s.reconnectDeadline),
    );
    const deadlineMsg = host.lastRoom().seats.find((s) => s && !s.connected)!;
    expect(Math.abs((deadlineMsg.reconnectDeadline ?? 0) - deadline)).toBeLessThan(120);

    // rejoin with same clientId before grace → seat restored, game continues
    const back = await C.connect(port, '客人', 'guest-id');
    back.send({ t: 'join', code });
    await back.waitFor(
      (m) => m.t === 'room' && m.room.you.role === 'seat' && m.room.seats[1]?.isYou === true,
    );
    await back.waitFor((m) => m.t === 'game');
    expect(back.lastRoom().seats[1]?.connected).toBe(true);

    host.close();
    back.close();
    await sleep(400);
  });

  it('disconnect past grace aborts the game', async () => {
    const { host, guest } = await startRoom(port);
    guest.close();
    const end = (await host.waitFor((m) => m.t === 'ended', 3000)) as Extract<
      ServerMsg,
      { t: 'ended' }
    >;
    expect(end.reason).toBe('timeout');
    expect(end.name).toBe('客人');
    await host.waitFor((m) => m.t === 'room' && m.room.status === 'waiting');
    host.close();
    await sleep(350);
  });

  it('host transfer and room deletion', async () => {
    const host = await C.connect(port, 'H', 'h9');
    host.send({ t: 'create' });
    const rm = (await host.waitFor((m) => m.t === 'room')) as Extract<ServerMsg, { t: 'room' }>;
    const guest = await C.connect(port, 'G', 'g9');
    guest.send({ t: 'join', code: rm.room.code });
    await guest.waitFor((m) => m.t === 'room' && m.room.seats[1]?.isYou === true);

    host.send({ t: 'leave' });
    await guest.waitFor((m) => m.t === 'room' && m.room.isHost === true);
    expect(guest.lastRoom().seats[0]?.isHost ?? guest.lastRoom().seats[1]?.isHost).toBe(true);

    // last member leaving deletes the room
    guest.send({ t: 'leave' });
    await sleep(50);
    const probe = await C.connect(port, 'P', 'p9');
    probe.send({ t: 'join', code: rm.room.code });
    const e = (await probe.waitFor((m) => m.t === 'error')) as Extract<ServerMsg, { t: 'error' }>;
    expect(e.message).toBe('房间不存在，检查一下房间码');
    probe.close();
    await sleep(350);
  });

  it('turn timer auto-plays a balanced move on expiry', async () => {
    const host = await C.connect(port, 'T', 't1');
    host.send({ t: 'create' });
    const rm = (await host.waitFor((m) => m.t === 'room')) as Extract<ServerMsg, { t: 'room' }>;
    const guest = await C.connect(port, 'T2', 't2');
    guest.send({ t: 'join', code: rm.room.code });
    await guest.waitFor((m) => m.t === 'room' && m.room.seats[1]?.isYou === true);

    host.send({ t: 'setRules', rules: { ...rm.room.rules, turnTimer: 60 } });
    await host.waitFor((m) => m.t === 'room' && m.room.rules.turnTimer === 60);
    host.send({ t: 'start' });
    await host.waitFor((m) => m.t === 'game');
    const turn0 = host.lastGame().view.turn;
    // nobody acts; timer fires at 60s * 0.008 = 480ms
    await host.waitFor((m) => m.t === 'game' && m.view.turn === turn0 + 1, 4000);
    expect(host.lastGame().view.turn).toBe(turn0 + 1);
    const logNames = host.lastGame();
    void logNames;
    host.close();
    guest.close();
    await sleep(400);
  });

  it('ready advances to next round; auto-advance works too', async () => {
    const { host, guest } = await startRoom(port);

    // play until a round ends (both sides take the trivial action)
    const clients: C[] = [host, guest];
    let guard = 0;
    for (;;) {
      const v = host.lastGame().view;
      if (v.phase === 'roundOver') break;
      if (v.phase !== 'playing') break;
      if (++guard > 200) throw new Error('round never ended');
      const actor = clients[v.current]!;
      // the non-acting socket may lag one broadcast; wait until the actor has
      // actually received the current turn's view
      await actor.waitFor((m) => m.t === 'game' && m.view.turn === v.turn, 4000);
      const av = actor.lastGame().view;
      const act = anyAction(av);
      actor.send({ t: 'act', action: act, turn: av.turn });
      try {
        await actor.waitFor((m) => m.t === 'game' && m.view.turn > av.turn, 4000);
      } catch (e) {
        const errs = actor.msgs.filter((m) => m.t === 'error').slice(-3);
        throw new Error(
          `act ${guard} stalled; turn=${av.turn} action=${JSON.stringify(act)} phase=${av.phase} errs=${JSON.stringify(errs)}`,
        );
      }
    }

    const round1 = host.lastGame().view.round;
    // one ready → stays; both → advances
    host.send({ t: 'ready' });
    await host.waitFor((m) => m.t === 'room' && m.room.ready[0] === true);
    guest.send({ t: 'ready' });
    await host.waitFor((m) => m.t === 'game' && m.view.round === round1 + 1, 4000);
    expect(host.lastGame().view.round).toBe(round1 + 1);

    // play a second round to completion, then let the auto timer advance it
    guard = 0;
    for (;;) {
      const v = host.lastGame().view;
      if (v.phase === 'roundOver') break;
      if (v.phase !== 'playing') break;
      if (++guard > 200) throw new Error('round never ended');
      const actor = clients[v.current]!;
      await actor.waitFor((m) => m.t === 'game' && m.view.turn === v.turn, 4000);
      const av = actor.lastGame().view;
      actor.send({ t: 'act', action: anyAction(av), turn: av.turn });
      await actor.waitFor((m) => m.t === 'game' && m.view.turn > av.turn, 4000);
    }
    // nobody readies; auto advance after roundAutoMs — unless the match ended
    const v2 = host.lastGame().view;
    if (v2.phase === 'roundOver') {
      await host.waitFor((m) => m.t === 'game' && m.view.round === v2.round + 1, 4000);
    } else {
      // matchOver: room returns to waiting with lastMatch set
      await host.waitFor(
        (m) => m.t === 'room' && m.room.status === 'waiting' && !!m.room.lastMatch,
        4000,
      );
    }
    host.close();
    guest.close();
    await sleep(400);
  }, 30000);

  it('sit rejects an invalid seat and never double-seats', async () => {
    const host = await C.connect(port, '主', 'v1');
    host.send({ t: 'create' });
    const rm = (await host.waitFor((m) => m.t === 'room')) as Extract<
      ServerMsg,
      { t: 'room' }
    >;
    const guest = await C.connect(port, '客', 'v2');
    guest.send({ t: 'join', code: rm.room.code });
    await guest.waitFor((m) => m.t === 'room' && m.room.seats[1]?.isYou === true);
    const spec = await C.connect(port, '观', 'v3');
    spec.send({ t: 'join', code: rm.room.code });
    await spec.waitFor((m) => m.t === 'room' && m.room.you.role === 'spectator');

    // seat 1 is occupied; {seat:5} must fail instead of falling through to 1
    spec.ws.send(JSON.stringify({ t: 'sit', seat: 5 }));
    const e = (await spec.waitFor(
      (m) => m.t === 'error' && m.code === 'bad_seat',
    )) as Extract<ServerMsg, { t: 'error' }>;
    expect(e.message).toBe('座位号无效');

    // force a fresh broadcast, then assert exactly one member per seat
    spec.send({ t: 'stand' });
    await spec.waitFor(
      (m) => m.t === 'room' && m.room.spectators.some((s) => s.name === '观'),
    );
    const room = spec.lastRoom();
    expect(room.seats[0]?.name).toBe('主');
    expect(room.seats[1]?.name).toBe('客');
    expect(room.spectators.map((s) => s.name)).toEqual(['观']);

    host.close();
    guest.close();
    spec.close();
    await sleep(350);
  });

  it('setRules rejects unknown keys and bad values atomically', async () => {
    const host = await C.connect(port, '规', 'r1');
    host.send({ t: 'create' });
    const rm = (await host.waitFor((m) => m.t === 'room')) as Extract<
      ServerMsg,
      { t: 'room' }
    >;
    const before = rm.room.rules;

    for (const patch of [
      { bogusKey: true },
      { turnTimer: 7 },
      { turnTimer: '60' },
      { matchLength: 'bestOf3' },
    ]) {
      host.ws.send(JSON.stringify({ t: 'setRules', rules: patch }));
      const e = (await host.waitFor(
        (m) => m.t === 'error' && m.code === 'bad_rules',
      )) as Extract<ServerMsg, { t: 'error' }>;
      expect(e.message).toBe('规则设置无效');
    }

    // rules untouched: a stand/sit round-trip forces fresh broadcasts
    host.send({ t: 'stand' });
    await host.waitFor((m) => m.t === 'room' && m.room.you.role === 'spectator');
    host.send({ t: 'sit', seat: 0 });
    await host.waitFor((m) => m.t === 'room' && m.room.you.role === 'seat');
    expect(host.lastRoom().rules).toEqual(before);

    // a valid patch still applies
    host.send({ t: 'setRules', rules: { ...before, turnTimer: 120 } });
    await host.waitFor((m) => m.t === 'room' && m.room.rules.turnTimer === 120);
    host.close();
    await sleep(350);
  });

  it('malformed messages get bad_message; state untouched; server stays alive', async () => {
    const { host, guest } = await startRoom(port);
    const v = host.lastGame().view;
    const meC = v.current === 0 ? host : guest;

    for (const raw of [
      { t: 'act', turn: 'x', action: { type: 'take', cardId: 'a' } },
      { t: 'act', turn: v.turn, action: { type: 'nuke' } },
      { t: 'act', turn: v.turn, action: { type: 'sell', cardIds: 'abc' } },
      { t: 'act', turn: v.turn, action: { type: 'exchange', take: ['a'], give: [1] } },
      { t: 'definitely-not-a-type' },
      42,
    ]) {
      meC.ws.send(JSON.stringify(raw));
      const e = (await meC.waitFor(
        (m) => m.t === 'error' && m.code === 'bad_message',
      )) as Extract<ServerMsg, { t: 'error' }>;
      expect(e.message).toBe('消息格式不对');
    }

    // the game state is exactly where it was
    expect(meC.lastGame().view.turn).toBe(v.turn);

    // and the socket still handles valid traffic
    meC.send({ t: 'act', action: anyAction(meC.lastGame().view), turn: v.turn });
    await meC.waitFor((m) => m.t === 'game' && m.view.turn === v.turn + 1);

    host.close();
    guest.close();
    await sleep(400);
  });

  it('joining another room aborts the old game immediately', async () => {
    const { host, guest } = await startRoom(port);

    const other = await C.connect(port, '另', 'o1');
    other.send({ t: 'create' });
    const rm2 = (await other.waitFor((m) => m.t === 'room')) as Extract<
      ServerMsg,
      { t: 'room' }
    >;

    // host jumps rooms — the old game must die now, not after the grace window
    host.send({ t: 'join', code: rm2.room.code });
    const end = (await guest.waitFor((m) => m.t === 'ended')) as Extract<
      ServerMsg,
      { t: 'ended' }
    >;
    expect(end.reason).toBe('left');
    expect(end.name).toBe('房主');
    await guest.waitFor((m) => m.t === 'room' && m.room.status === 'waiting');
    // the deserter is fully gone, guest inherits the host role
    const gRoom = guest.lastRoom();
    expect(gRoom.seats.filter(Boolean).map((s) => s!.name)).toEqual(['客人']);
    expect(gRoom.isHost).toBe(true);

    // and the host landed in the new room on the free seat
    await host.waitFor(
      (m) => m.t === 'room' && m.room.code === rm2.room.code && m.room.you.role === 'seat',
    );

    host.close();
    guest.close();
    other.close();
    await sleep(400);
  });
});
