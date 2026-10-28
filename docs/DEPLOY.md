# Deploying Ø Universe

One service runs everything: the Node 26 game server (`server/`) serves the built
web client, the game WebSocket (`/ws`), `/healthz` and the account / experience API
under `/api`. The Docker image builds the client itself, so a deploy is just
"push to GitHub".

**The world (PLATFORM.md §11):** one server = one persistent, seamless world (instance
`world`, up to 50 players): the hand-made hub in the middle (|x|, |z| ≤ 1100 m — a safe
zone: no enemies, combat, damage, hunger or building) and the infinite survival planet
around it (procedural terrain, biomes, resources, enemies, player bases). Everything the
server needs to know about a location (heights, water, safe zone, spawns, resource nodes,
build rules) comes from one world provider: `shared/worldgen` when it is present, else the
stand-in terrain (`shared/sim/standin.js`: the hub heightfield + simple noise hills). More
worlds later = more services, each with its own database or volume.

```
browser ──https──▶ Railway edge ──▶ container: node server/index.js  (PORT from Railway)
                                     ├─ GET /, /assets/*   built client (dist/)
                                     ├─ WS  /ws            the world (shared/sim authoritative, 20 Hz)
                                     ├─ /api/*             accounts, friends, experiences (server/platform)
                                     ├─ GET /healthz       {ok, players, uptime, …}
                                     └─ store: Postgres (DATABASE_URL) or JSON files in DATA_DIR
```

> **Kort (NL):** `npm run build && npm run server` → http://127.0.0.1:8080. Online: Railway →
> *Deploy from GitHub repo* → *Generate Domain* → Postgres toevoegen en `DATABASE_URL` =
> `${{Postgres.DATABASE_URL}}` (of een volume op `/data` + `RAILWAY_RUN_UID=0`). Klaar.

## 1. Run it locally first

```bash
npm ci
npm run build          # client → dist/
npm run server         # node server/index.js --local → http://127.0.0.1:8080
```

Open http://127.0.0.1:8080 in a normal and a private window (or two different browsers):
you see each other move and chat. (Two tabs of the same browser profile share one guest
token, so they are the same player — the newest tab takes over.) Saves go to `./data`
(guest players, the world, accounts). The first boot bakes the hub terrain (~2–4 s) and
caches it in `./data/cache`, later boots take well under a second.

- `npm run dev` (Vite, hot reload) proxies `/ws` to the server on :8080 (`WS_TARGET`
  overrides), so the dev client is online too; without a server it falls back to the
  in-browser world ("Offline mode") after 4 s. `?offline` forces that, `?server=<host>`
  picks another server.
- `npm test` runs the protocol, simulation and server tests (`node --test server/` only the server).
- A second local server for experiments: `PORT=8090 DATA_DIR=/tmp/ou-data STATIC_DIR=dist node server/index.js --local`.
- Ctrl+C (or SIGTERM) saves the world and every online player, then stops; a second Ctrl+C more
  than 1.5 s later quits at once without the final save.

Docker (optional, the same image Railway builds):

```bash
docker build -t o-universe .
docker run --rm -p 8080:8080 -v o-universe-data:/data o-universe     # → http://localhost:8080
```

## 2. Railway, step by step

1. **Create the service** — railway.com → *New Project* → *Deploy from GitHub repo* →
   pick this repository (authorise the Railway GitHub app if asked). Railway reads
   `railway.json`: Dockerfile build, health check `GET /healthz`, restart on failure.
   The first build takes ~3–5 minutes.
2. **Give it a public URL** — service → *Settings* → *Networking* → *Generate Domain*
   (`<name>.up.railway.app`). WebSockets work on the same domain (`wss://…/ws`); nothing
   else to configure. Railway sets `PORT` itself — don't add it.
3. **Make saves permanent — pick one:**
   - **Postgres (recommended)** — in the project: *+ Create* → *Database* → *PostgreSQL*.
     Then game service → *Variables* → *New Variable* → `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
     (a reference variable; the private-network URL is fine). The server creates its tables
     on boot (game: `players`, `world`; platform: `users`, `sessions`, `friends`, `experiences`,
     `experience_versions`, `likes`, `reports`). Railway's Postgres has its own backups (Pro)
     and you can `pg_dump` it any time.
   - **Volume** — game service → right-click / *Settings* → *Attach Volume* → mount path `/data`.
     Add the variable `RAILWAY_RUN_UID=0`: Railway volumes are owned by root and the image
     runs as the unprivileged `node` user (without it the server refuses to start with a
     "DATA_DIR … is not writable" message instead of silently losing saves). The server
     finds the mount path by itself (`RAILWAY_VOLUME_MOUNT_PATH`, or set `DATA_DIR=/data`).
     With a volume Railway stops the old deployment before starting the new one, so a
     redeploy has ~10–30 s downtime (players reconnect by themselves).
   - Neither — it works, but every redeploy starts a fresh world (container disk is temporary).
     `/healthz` shows `"store":"json"` either way; check that a volume is mounted.
4. **Optional variables** (none are required)

   | variable | default | what |
   |---|---|---|
   | `LOG_LEVEL` | `info` | `debug` · `info` · `warn` · `error` |
   | `ALLOWED_ORIGINS` | same host | extra origins allowed to open `/ws` and call `/api`, comma separated (`https://play.example.com`) — only needed when the client is hosted elsewhere |
   | `DATA_DIR` | `/data` in the image | JSON saves + the terrain cache (with Postgres only the cache) |
   | `DATABASE_SSL` | off | `1` = SSL without CA checks (some external Postgres hosts; Railway's private URL needs nothing) |
   | `WORLD_SEED` | `o-universe` | seed of the procedural planet — set it only for a **new** world (bases sit on the terrain of the seed they were built on; the world save remembers its seed and a mismatch is logged as an error) |
   | `WORLDGEN` | `auto` | `auto` = `shared/worldgen`, else the stand-in; `worldgen` / `standin` force one (the server refuses to start when it can't load) |
   | `SIM` | `auto` | `real` = refuse to start when `shared/sim` can't load (instead of the movement + chat stub) |
   | `TRUST_PROXY` | `1` (`0` with `--local`) | use `X-Forwarded-For` for the per-IP limits (right behind Railway's edge) |
   | `MAX_CONNS_PER_IP` | `16` | parallel sockets per IP |
   | `IDLE_TIMEOUT_MS` | `60000` | disconnect after this long without any message (clients ping every 2 s) |
   | `HEARTBEAT_MS` | `20000` | WebSocket ping interval; a client that misses one is dropped |
   | `AUTOSAVE_MS` | `30000` | world + online players autosave interval |
   | `SHUTDOWN_GRACE_MS` | `8000` | max time for the final save on SIGTERM |
   | `WS_DEFLATE` | `1` | `0` turns off WebSocket compression (less CPU, ~3× more traffic) |
   | `LOG_FORMAT` | `json` (no TTY) | `pretty` for humans |

5. **Custom domain** — service → *Settings* → *Networking* → *Custom Domain* → enter e.g.
   `play.example.com` → add the CNAME record Railway shows at your DNS provider → wait for
   the certificate (minutes). The game, its WebSocket and the API move with it automatically
   (same origin). Keep the `up.railway.app` domain or remove it, both work.
6. **Check it** — open `https://<domain>/healthz` → `{"ok":true,"players":0,"sim":"real",
   "store":"postgres"|"json","gen":"worldgen"|"standin", …}`; then open the game in two browsers.

Every push to the deploy branch redeploys (only when game files change: see
`watchPatterns` in `railway.json` — add new top-level folders there if you create any).

## 3. Operations

- **Logs**: one JSON object per line (`level`, `msg`, fields) — use Railway's log filter, e.g.
  `@level:error`. Joins/leaves are `info`, chat is `debug` only (privacy).
- **/healthz**: players, uptime, `sim` (`real`, or `stub` if the simulation failed to load —
  check the error log), `gen` (world provider: `worldgen`, `standin`, or `hub` = terrain only),
  store kind, world stats (enemies, loot, structures, claims), tick timing (`tick.avgMs` should
  stay well below 50), network counters (messages, bytes, skipped snapshots), save stats, memory.
- **Deploys / restarts**: Railway sends SIGTERM → the server saves the world and every online
  player, tells clients "server restarting" (they reconnect by themselves) and exits.
  `drainingSeconds: 20` in `railway.json` gives it the time. Crashes restart automatically
  (`ON_FAILURE`, 10 retries). Autosave runs every 30 s, players are also saved when they leave.
- **Deploy overlap with Postgres**: the new deployment may start while the old one still runs.
  The server reloads a newer world save before the first player joins an empty world, so a
  deploy never rolls the world back.
- **Saves**: a guest's progress (position, health, inventory, unlocks) belongs to the token in
  their browser; a signed-in account keeps one save on every device (the guest save is linked
  when they register). JSON store layout: `world.json` (+ `world.prev.json`, an older copy),
  `players/p<n>.json`, `players/tokens.log` (hashes only — tokens are never stored),
  `platform/` (accounts), `cache/` (terrain, safe to delete).
- **Backups**: Postgres → `pg_dump "$DATABASE_URL" > backup.sql` (Railway's *Connect* tab shows
  the public URL). Volume → copy the files with `railway ssh` (`tar czf - /data`) or snapshot it
  in the Railway volume settings.
- **Scaling**: one world = one process (`numReplicas: 1`, never more for the same database).
  Up to 50 players per world (`full` error after that). Another world = another service with
  its own database / volume.

### Troubleshooting

| symptom | cause / fix |
|---|---|
| deploy fails with "DATA_DIR … is not writable" | volume without `RAILWAY_RUN_UID=0` (or set `DATABASE_URL`) |
| players stay "Offline mode" | the socket can't open: check `/healthz`, the browser console (`/ws` 403 = origin → set `ALLOWED_ORIGINS` when the page is served from another domain) |
| `/healthz` says `"sim":"stub"` | `shared/sim` failed to import — the first error log line has the reason; set `SIM=real` to fail the deploy instead |
| everyone was reset after a deploy | no Postgres and no volume (container disk is temporary) |
| "postgres not ready, retrying" at boot | normal while the database starts; after 10 tries the server exits and Railway restarts it |

## 4. What it costs (Railway, October 2026 — check railway.com/pricing)

- Plans: *Hobby* $5/month including $5 of usage (enough for a small friends server);
  *Pro* $20/month including $20. Usage is per second: RAM ≈ $10 per GB-month,
  CPU ≈ $20 per vCPU-month, egress $0.05/GB, volumes $0.15 per GB-month.
- The game server idles at roughly 100–200 MB RAM and a few % of a vCPU →
  about $2–4/month on its own; Postgres adds a similar small amount.
- Traffic is the variable part: a player receives ~5–20 KB/s of world snapshots while
  playing (compressed). 10 friends for 3 hours ≈ 1–2 GB ≈ $0.10; a full 50-player evening
  can reach 5–10 GB ≈ $0.25–0.50.
