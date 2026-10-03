/**
 * Jaipur PVP server — express 5 static + ws 8 rooms, all in memory.
 * Wire protocol lives in src/shared/protocol.ts; the engine is the only
 * source of truth for legality. GameState and foreign clientIds never
 * leave this process: every client receives viewFor(state, seat|null).
 */
import express from 'express';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import {
  createMatch,
  applyAction,
  checkAction,
  actionContextFor,
  viewFor,
  nextRound,
  mulberry32,
  DEFAULT_RULES,
  PLAYER_COUNT,
  RULE_META,
} from '../shared/engine/index';
import { chooseAction } from '../shared/ai/index';
import { describeEvent } from '../shared/describe';
import type { GameState, RuleOptions } from '../shared/engine/index';
import {
  ROOM_ALPHABET,
  ROOM_CODE_LEN,
  MAX_ROOMS,
  MAX_SPECTATORS,
  MAX_PAYLOAD,
  MAX_MSG_PER_SEC,
  NAME_MAX,
  type ClientMsg,
  type ServerMsg,
  type RoomPublic,
  type LogLine,
} from '../shared/protocol';

export interface ServerOptions {
  port?: number;
  host?: string;
  /** ms a disconnected member may rejoin before being dropped (default 30s) */
  graceMs?: number;
  /** ms after roundOver before the next round auto-starts (default 20s) */
  roundAutoMs?: number;
  /** multiplies turnTimer seconds — tests shrink it below 1 */
  timerScale?: number;
  /** static dir; defaults to dist/client next to the bundled server */
  clientDir?: string;
  /** messages/second cap per socket; 0 disables (tests) */
  ratePerSec?: number;
}

interface Conn {
  ws: WebSocket;
  clientId: string | null;
  name: string;
  room: Room | null;
  alive: boolean;
  rateCount: number;
  rateWindow: number;
}

interface Member {
  clientId: string;
  name: string;
  seat: 0 | 1 | null;
  isHost: boolean;
  connected: boolean;
  conn: Conn | null;
  reconnectDeadline: number | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

interface Room {
  code: string;
  members: Map<string, Member>;
  rules: RuleOptions;
  status: 'waiting' | 'playing';
  state: GameState | null;
  names: [string, string];
  log: LogLine[];
  logId: number;
  ready: [boolean, boolean];
  readySince: number | null;
  turnTimer: ReturnType<typeof setTimeout> | null;
  turnDeadline: number | null;
  roundTimer: ReturnType<typeof setTimeout> | null;
  lastMatch: { winners: number[]; names: [string, string] } | null;
  rng: () => number;
}

const CODE_CHARS = ROOM_ALPHABET;

function makeCode(): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}

/* ── wire-shape validation (S3): runs before any state mutation ── */

const KNOWN_TYPES = new Set([
  'hello',
  'create',
  'join',
  'leave',
  'sit',
  'stand',
  'setRules',
  'start',
  'act',
  'ready',
  'ping',
]);
const ACTION_TYPES = new Set(['take', 'camels', 'exchange', 'sell']);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrArr = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 12 && v.every(isStr);

function shapeOk(msg: unknown): msg is ClientMsg {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return false;
  const m = msg as Record<string, unknown>;
  if (!isStr(m.t) || !KNOWN_TYPES.has(m.t)) return false;
  switch (m.t) {
    case 'hello':
      return (
        isStr(m.clientId) &&
        m.clientId.length >= 16 &&
        m.clientId.length <= 64 &&
        isStr(m.name)
      );
    case 'join':
      return isStr(m.code) && m.code.length <= 8;
    case 'act': {
      if (!Number.isInteger(m.turn)) return false;
      const a = m.action;
      if (typeof a !== 'object' || a === null || Array.isArray(a)) return false;
      const act = a as Record<string, unknown>;
      if (!isStr(act.type) || !ACTION_TYPES.has(act.type)) return false;
      if ('cardId' in act && !isStr(act.cardId)) return false;
      if ('take' in act && !isStrArr(act.take)) return false;
      if ('give' in act && !isStrArr(act.give)) return false;
      if ('cardIds' in act && !isStrArr(act.cardIds)) return false;
      return true;
    }
    default:
      return true;
  }
}

/* ── rules patch validation (S1): whole message rejected on any bad entry ── */

const ruleMetaByKey = new Map(RULE_META.map((m) => [m.key, m]));

function validRulesPatch(patch: unknown): patch is Partial<RuleOptions> {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return false;
  for (const [k, v] of Object.entries(patch)) {
    const meta = ruleMetaByKey.get(k as keyof RuleOptions);
    if (!meta || !meta.options.some((o) => o.value === v)) return false;
  }
  return true;
}

function cleanName(raw: unknown): string {
  const s = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    .trim();
  return s.slice(0, NAME_MAX) || '玩家';
}

export function createServer(opts: ServerOptions = {}): HttpServer {
  const graceMs = opts.graceMs ?? 30_000;
  const roundAutoMs = opts.roundAutoMs ?? 20_000;
  const timerScale = opts.timerScale ?? 1;
  const ratePerSec = opts.ratePerSec ?? MAX_MSG_PER_SEC;
  const clientDir =
    opts.clientDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client');

  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => {
    res.type('text/plain').send('ok');
  });
  app.use(express.static(clientDir));
  // SPA fallback — /r/CODE and friends all serve the app shell
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(clientDir, 'index.html'), (err) => {
      if (err) res.status(404).end();
    });
  });

  const server = createHttpServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_PAYLOAD });

  const rooms = new Map<string, Room>();
  const byConn = new Map<WebSocket, Conn>();

  /* ---------------- helpers ---------------- */

  const send = (conn: Conn, msg: ServerMsg) => {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
  };
  const sendErr = (conn: Conn, code: string, message: string) =>
    send(conn, { t: 'error', code, message });

  function publicRoom(room: Room, viewer: Member): RoomPublic {
    const seats = [0, 1].map((i) => {
      const m = [...room.members.values()].find((x) => x.seat === i);
      if (!m) return null;
      const out: RoomPublic['seats'][number] = {
        name: m.name,
        connected: m.connected,
        isHost: m.isHost,
        isYou: m === viewer,
      };
      if (!m.connected && m.reconnectDeadline) out.reconnectDeadline = m.reconnectDeadline;
      return out;
    });
    const spectators = [...room.members.values()]
      .filter((m) => m.seat === null)
      .map((m) => ({ name: m.name, isYou: m === viewer }));
    const out: RoomPublic = {
      code: room.code,
      status: room.status,
      seats: [seats[0] ?? null, seats[1] ?? null],
      spectators,
      you: viewer.seat === null ? { role: 'spectator' } : { role: 'seat', seat: viewer.seat },
      isHost: viewer.isHost,
      rules: room.rules,
      ready: [...room.ready],
    };
    if (room.turnDeadline && room.status === 'playing') out.turnDeadline = room.turnDeadline;
    if (room.lastMatch) out.lastMatch = room.lastMatch;
    return out;
  }

  function eachConn(room: Room, fn: (conn: Conn, member: Member) => void) {
    for (const m of room.members.values()) if (m.conn) fn(m.conn, m);
  }

  function broadcastRoom(room: Room) {
    eachConn(room, (conn, m) => send(conn, { t: 'room', room: publicRoom(room, m) }));
  }

  function broadcastGame(room: Room) {
    if (!room.state) return;
    eachConn(room, (conn, m) =>
      send(conn, {
        t: 'game',
        view: viewFor(room.state!, m.seat),
        log: room.log,
        names: room.names,
      }),
    );
  }

  function recordEvents(room: Room) {
    if (!room.state) return;
    for (const e of room.state.lastEvents) {
      const d = describeEvent(e, room.names);
      if (d) room.log.push({ id: ++room.logId, round: room.state.round, seat: d.seat, text: d.text });
    }
    if (room.log.length > 400) room.log = room.log.slice(-400);
  }

  /* ---------------- timers ---------------- */

  function clearTurnTimer(room: Room) {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnDeadline = null;
  }

  function scheduleTurnTimer(room: Room) {
    clearTurnTimer(room);
    const secs = room.rules.turnTimer;
    const s = room.state;
    if (!s || s.phase !== 'playing' || secs <= 0) return;
    const turnAt = s.turn;
    room.turnDeadline = Date.now() + secs * 1000 * timerScale;
    room.turnTimer = setTimeout(() => {
      room.turnTimer = null;
      room.turnDeadline = null;
      const st = room.state;
      if (!st || st.phase !== 'playing' || st.turn !== turnAt) return;
      const seat = st.current;
      const action = chooseAction(viewFor(st, seat), 'balanced', room.rng);
      try {
        room.state = applyAction(st, seat, action);
      } catch {
        return;
      }
      room.log.push({
        id: ++room.logId,
        round: room.state.round,
        seat,
        text: `${room.names[seat]} 超时，系统代走一步`,
      });
      recordEvents(room);
      afterStateChange(room);
    }, room.turnDeadline - Date.now());
  }

  function clearRoundTimer(room: Room) {
    if (room.roundTimer) clearTimeout(room.roundTimer);
    room.roundTimer = null;
  }

  function scheduleRoundTimer(room: Room) {
    clearRoundTimer(room);
    room.readySince = Date.now();
    room.roundTimer = setTimeout(() => {
      room.roundTimer = null;
      if (room.state?.phase !== 'roundOver') return;
      doNextRound(room);
    }, roundAutoMs);
  }

  /** called after every state mutation */
  function afterStateChange(room: Room) {
    const s = room.state!;
    if (s.phase === 'matchOver') {
      clearTurnTimer(room);
      clearRoundTimer(room);
      room.status = 'waiting';
      room.lastMatch = { winners: s.matchWinners ?? [], names: room.names };
      room.ready = [false, false];
    } else if (s.phase === 'roundOver') {
      clearTurnTimer(room);
      if (!room.roundTimer) scheduleRoundTimer(room);
      room.ready = [false, false];
    } else {
      clearRoundTimer(room);
      room.ready = [false, false];
      scheduleTurnTimer(room);
    }
    broadcastGame(room);
    broadcastRoom(room);
  }

  function doNextRound(room: Room) {
    if (!room.state || room.state.phase !== 'roundOver') return;
    try {
      room.state = nextRound(room.state);
    } catch {
      return;
    }
    recordEvents(room);
    afterStateChange(room);
  }

  /* ---------------- membership ---------------- */

  function removeMember(room: Room, member: Member) {
    if (member.graceTimer) clearTimeout(member.graceTimer);
    if (member.conn) {
      member.conn.room = null;
      member.conn = null;
    }
    room.members.delete(member.clientId);
    if (member.isHost) {
      member.isHost = false;
      const next =
        [...room.members.values()].find((m) => m.seat !== null) ??
        room.members.values().next().value;
      if (next) next.isHost = true;
    }
    if (room.members.size === 0) {
      destroyRoom(room);
      return;
    }
    broadcastRoom(room);
  }

  function destroyRoom(room: Room) {
    clearTurnTimer(room);
    clearRoundTimer(room);
    for (const m of room.members.values()) {
      if (m.graceTimer) clearTimeout(m.graceTimer);
      if (m.conn) m.conn.room = null;
    }
    rooms.delete(room.code);
  }

  /** a seated player is gone mid-game: end it, back to waiting */
  function abortGame(room: Room, member: Member, reason: 'left' | 'timeout') {
    room.state = null;
    room.status = 'waiting';
    room.ready = [false, false];
    clearTurnTimer(room);
    clearRoundTimer(room);
    eachConn(room, (conn) =>
      send(conn, { t: 'ended', reason, name: member.name }),
    );
    removeMember(room, member);
  }

  function attachConn(room: Room, member: Member, conn: Conn) {
    member.conn = conn;
    member.connected = true;
    member.reconnectDeadline = null;
    if (member.graceTimer) {
      clearTimeout(member.graceTimer);
      member.graceTimer = null;
    }
    conn.room = room;
    conn.clientId = member.clientId;
    conn.name = member.name;
    send(conn, { t: 'room', room: publicRoom(room, member) });
    if (room.state) broadcastGame(room);
    broadcastRoom(room);
  }

  function detachConn(conn: Conn) {
    const room = conn.room;
    conn.room = null;
    if (!room) return;
    const member = room.members.get(conn.clientId ?? '');
    if (!member || member.conn !== conn) return;
    member.conn = null;
    member.connected = false;
    member.reconnectDeadline = Date.now() + graceMs;
    broadcastRoom(room);
    member.graceTimer = setTimeout(() => {
      member.graceTimer = null;
      if (member.connected) return;
      if (room.status === 'playing' && member.seat !== null) {
        abortGame(room, member, 'timeout');
      } else {
        removeMember(room, member);
      }
    }, graceMs);
  }

  function joinRoom(conn: Conn, code: string) {
    const room = rooms.get(code.toUpperCase());
    if (!room) return sendErr(conn, 'no_room', '房间不存在，检查一下房间码');
    // joining another room leaves the old one explicitly — an in-game seat
    // aborts that game now rather than waiting out the grace window (S5)
    if (conn.room && conn.room !== room) leaveRoom(conn, true);

    const existing = room.members.get(conn.clientId!);
    if (existing) {
      // known clientId rejoins with its previous role
      existing.name = conn.name;
      attachConn(room, existing, conn);
      return;
    }
    if (room.members.size >= PLAYER_COUNT + MAX_SPECTATORS)
      return sendErr(conn, 'room_full', '房间人满了');

    const member: Member = {
      clientId: conn.clientId!,
      name: conn.name,
      seat: null,
      isHost: room.members.size === 0,
      connected: true,
      conn,
      reconnectDeadline: null,
      graceTimer: null,
    };
    if (room.status === 'waiting') {
      for (const i of [0, 1] as const) {
        if (![...room.members.values()].some((m) => m.seat === i)) {
          member.seat = i;
          break;
        }
      }
    }
    room.members.set(member.clientId, member);
    conn.room = room;
    send(conn, { t: 'room', room: publicRoom(room, member) });
    if (room.state) broadcastGame(room);
    broadcastRoom(room);
  }

  function leaveRoom(conn: Conn, explicit: boolean) {
    const room = conn.room;
    if (!room) return;
    const member = room.members.get(conn.clientId ?? '');
    conn.room = null;
    if (!member) return;
    if (explicit && room.status === 'playing' && member.seat !== null) {
      abortGame(room, member, 'left');
      return;
    }
    if (explicit) removeMember(room, member);
    else detachConn(conn);
  }

  /* ---------------- game actions ---------------- */

  function startGame(room: Room) {
    const seatMembers = [0, 1].map((i) =>
      [...room.members.values()].find((m) => m.seat === i),
    );
    const names: [string, string] = [seatMembers[0]!.name, seatMembers[1]!.name];
    const seed = Array.from(crypto.getRandomValues(new Uint32Array(8)));
    room.names = names;
    room.state = createMatch({ seed, rules: room.rules });
    room.status = 'playing';
    room.log = [];
    room.logId = 0;
    room.ready = [false, false];
    room.readySince = null;
    recordEvents(room);
    afterStateChange(room);
  }

  /* ---------------- message handling ---------------- */

  function requireMember(conn: Conn): { room: Room; member: Member } | null {
    const room = conn.room;
    if (!room) {
      sendErr(conn, 'no_room', '你不在房间里');
      return null;
    }
    const member = room.members.get(conn.clientId ?? '');
    if (!member) {
      sendErr(conn, 'no_room', '你不在房间里');
      return null;
    }
    return { room, member };
  }

  function handle(conn: Conn, msg: ClientMsg) {
    switch (msg.t) {
      case 'ping':
        send(conn, { t: 'pong' });
        return;
      case 'hello': {
        conn.clientId = msg.clientId;
        conn.name = cleanName(msg.name);
        send(conn, { t: 'welcome', clientId: conn.clientId });
        return;
      }
      default:
        break;
    }
    if (!conn.clientId) return sendErr(conn, 'no_hello', '先打招呼');

    switch (msg.t) {
      case 'create': {
        if (rooms.size >= MAX_ROOMS) return sendErr(conn, 'full', '服务器房间已满');
        if (conn.room) leaveRoom(conn, true);
        let code = makeCode();
        while (rooms.has(code)) code = makeCode();
        const room: Room = {
          code,
          members: new Map(),
          rules: { ...DEFAULT_RULES },
          status: 'waiting',
          state: null,
          names: ['玩家1', '玩家2'],
          log: [],
          logId: 0,
          ready: [false, false],
          readySince: null,
          turnTimer: null,
          turnDeadline: null,
          roundTimer: null,
          lastMatch: null,
          rng: mulberry32(crypto.getRandomValues(new Uint32Array(1))[0]! >>> 0),
        };
        rooms.set(code, room);
        joinRoom(conn, code);
        return;
      }
      case 'join':
        joinRoom(conn, String(msg.code ?? ''));
        return;
      case 'leave':
        leaveRoom(conn, true);
        return;
      case 'sit': {
        const ctx = requireMember(conn);
        if (!ctx) return;
        const { room, member } = ctx;
        if (room.status === 'playing') return sendErr(conn, 'playing', '对局中不能换座');
        if (msg.seat !== 0 && msg.seat !== 1)
          return sendErr(conn, 'bad_seat', '座位号无效');
        if (member.seat === msg.seat) return;
        if ([...room.members.values()].some((m) => m.seat === msg.seat))
          return sendErr(conn, 'seat_taken', '这个座位已经有人了');
        member.seat = msg.seat;
        broadcastRoom(room);
        return;
      }
      case 'stand': {
        const ctx = requireMember(conn);
        if (!ctx) return;
        const { room, member } = ctx;
        if (room.status === 'playing') return sendErr(conn, 'playing', '对局中不能换座');
        member.seat = null;
        if (member.isHost) {
          const next = [...room.members.values()].find((m) => m.seat !== null) ?? member;
          if (next !== member) {
            member.isHost = false;
            next.isHost = true;
          }
        }
        broadcastRoom(room);
        return;
      }
      case 'setRules': {
        const ctx = requireMember(conn);
        if (!ctx) return;
        const { room, member } = ctx;
        if (!member.isHost) return sendErr(conn, 'not_host', '只有房主可以改规则');
        if (room.status === 'playing') return sendErr(conn, 'playing', '对局中不能改规则');
        if (!validRulesPatch(msg.rules))
          return sendErr(conn, 'bad_rules', '规则设置无效');
        room.rules = { ...room.rules, ...msg.rules };
        broadcastRoom(room);
        return;
      }
      case 'start': {
        const ctx = requireMember(conn);
        if (!ctx) return;
        const { room, member } = ctx;
        if (!member.isHost) return sendErr(conn, 'not_host', '只有房主可以开局');
        if (room.status !== 'waiting') return;
        const seats = [0, 1].map((i) =>
          [...room.members.values()].find((m) => m.seat === i && m.connected),
        );
        if (!seats[0] || !seats[1])
          return sendErr(conn, 'need_players', '两个座位都坐满后才能开局');
        startGame(room);
        return;
      }
      case 'act': {
        const ctx = requireMember(conn);
        if (!ctx) return;
        const { room, member } = ctx;
        const s = room.state;
        if (!s || room.status !== 'playing' || s.phase !== 'playing') return;
        if (member.seat !== s.current) return sendErr(conn, 'not_turn', '还没轮到你行动');
        if (msg.turn !== s.turn)
          return sendErr(conn, 'stale', '这一步已过期，请按最新局面操作');
        const chk = checkAction(actionContextFor(s, member.seat), msg.action);
        if (!chk.ok) return sendErr(conn, 'illegal', chk.reason);
        room.state = applyAction(s, member.seat, msg.action);
        recordEvents(room);
        afterStateChange(room);
        return;
      }
      case 'ready': {
        const ctx = requireMember(conn);
        if (!ctx) return;
        const { room, member } = ctx;
        if (member.seat === null || !room.state || room.state.phase !== 'roundOver') return;
        room.ready[member.seat] = true;
        if (room.ready[0] && room.ready[1]) doNextRound(room);
        else broadcastRoom(room);
        return;
      }
    }
  }

  /* ---------------- wiring ---------------- */

  wss.on('connection', (ws) => {
    const conn: Conn = {
      ws,
      clientId: null,
      name: '玩家',
      room: null,
      alive: true,
      rateCount: 0,
      rateWindow: Date.now(),
    };
    byConn.set(ws, conn);
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data) => {
      const now = Date.now();
      if (now - conn.rateWindow > 1000) {
        conn.rateWindow = now;
        conn.rateCount = 0;
      }
      if (ratePerSec > 0 && ++conn.rateCount > ratePerSec) {
        ws.terminate();
        return;
      }
      let msg: ClientMsg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return sendErr(conn, 'bad_message', '消息格式不对');
      }
      if (!shapeOk(msg)) return sendErr(conn, 'bad_message', '消息格式不对');
      try {
        handle(conn, msg);
      } catch (err) {
        console.error('[jaipur] handler error', err);
        sendErr(conn, 'internal', '服务器内部错误');
      }
    });
    ws.on('close', () => {
      byConn.delete(ws);
      detachConn(conn);
    });
    ws.on('error', () => {
      byConn.delete(ws);
      detachConn(conn);
    });
  });

  const heartbeat = setInterval(() => {
    for (const conn of byConn.values()) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }, 20_000);
  heartbeat.unref();

  server.on('close', () => {
    clearInterval(heartbeat);
    for (const conn of byConn.values()) conn.ws.terminate();
    for (const room of rooms.values()) destroyRoom(room);
    wss.close();
  });

  const port = opts.port ?? Number(process.env.PORT ?? 8787);
  const host = opts.host ?? process.env.HOST ?? '0.0.0.0';
  server.listen(port, host, () => {
    const a = server.address();
    console.log(`[jaipur] listening on http://${host}:${typeof a === 'object' ? a?.port : port}`);
  });
  return server;
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) createServer();
