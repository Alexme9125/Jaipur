# Agent notes — Jaipur

## Commands

```bash
npm install
npm run dev          # vite :5173 (+1 if busy) + ws server :8787, /ws proxied
npm run typecheck    # tsc --noEmit (strict)
npm test             # vitest: engine + ai + server suites
npm run build        # dist/client (vite) + dist/server/index.js (esbuild bundle)
npm start            # production server, PORT/HOST envs, /healthz → ok
```

## Layout

- `src/shared/` — pure deterministic engine (`engine/`), AI (`ai/`), ws protocol (`protocol.ts`), event text (`describe.ts`). Everything here is isomorphic: imported by client and server.
- `src/client/` — React/Vite UI. Only talks to games through `GameDriver` (`game/driver.ts`); `local.ts` = PVE, `remote.ts` = ws rooms.
- `src/server/` — express 5 + ws 8 room server (`index.ts`, `createServer({port, graceMs, roundAutoMs, timerScale})`).
- `tests/` — vitest suites; server tests use real ws clients on ephemeral ports.
- `RULES.md` — authoritative game rules.

## Rules

- No commits, no pushes unless the user asks.
- Engine stays pure + serializable; never send raw `GameState` to clients — always `viewFor(state, seat|null)`.

## Screenshots / browser verification

Playwright is a devDependency. Put scripts in `.artifacts/` (gitignored) and run with
`node .artifacts/<script>.mjs`. Patterns used:

- dev server already running → `chromium.launch()` + `page.goto('http://localhost:5175/?seed=42&autoplay=1')`.
- Collect `page.on('console')` / `page.on('pageerror')` into a log file; assert zero errors.
- `?seed=N` makes PVE deterministic; `?autoplay=1` plays a full match automatically.
- Name artifacts `v2-<what>-<WxH>.png` (or `.txt` for logs).
- For PVP flows use three `browser.newContext()` pages sharing the room code.
