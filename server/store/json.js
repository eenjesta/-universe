import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic, KeyedQueue } from './fsutil.js';

/**
 * JSON-file store in DATA_DIR (PLATFORM.md §5 store interface).
 *
 *   world.json           { v, id: 'world', updatedAt, data }   (atomic writes; one world per server)
 *   world.prev.json      copy of the previous world.json (first save after boot, then every 10th)
 *   players/<id>.json    { id, tokenHash, name, appearance, save, createdAt, lastSeen }
 *   players/tokens.log   append-only "tokenHash id" lines (lookup index; rebuilt from
 *                        the player files when lines are missing)
 *
 * Player ids are 'p' + a counter ('p1', 'p2', …) and double as entity ids in the
 * world, so structure/claim owners stay stable across sessions.
 * Tokens are never stored — only their sha-256 hash.
 */
export async function createJsonStore({ dir, log }) {
  const playersDir = path.join(dir, 'players');
  const worldFile = path.join(dir, 'world.json');
  const prevFile = path.join(dir, 'world.prev.json');
  const tokensLog = path.join(playersDir, 'tokens.log');
  await fsp.mkdir(playersDir, { recursive: true });
  const q = new KeyedQueue();

  /** tokenHash → id */
  const tokens = new Map();
  /** id → record (players touched in this run) */
  const records = new Map();
  let nextId = 1;
  let worldSaves = 0;

  const idNum = (id) => Number.parseInt(String(id).slice(1), 10) || 0;
  const playerFile = (id) => {
    if (!/^p\d{1,12}$/.test(id)) throw new Error(`bad player id ${id}`);
    return path.join(playersDir, `${id}.json`);
  };

  // ------------------------------------------------------------ boot: index
  try {
    const txt = await fsp.readFile(tokensLog, 'utf8');
    for (const line of txt.split('\n')) {
      const [hash, id] = line.trim().split(' ');
      if (hash && /^p\d+$/.test(id || '')) {
        tokens.set(hash, id);
        nextId = Math.max(nextId, idNum(id) + 1);
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') log.warn('tokens.log unreadable, rebuilding from player files', { err });
  }
  const known = new Set(tokens.values());
  let repaired = 0;
  for (const f of await fsp.readdir(playersDir)) {
    const m = /^(p\d+)\.json$/.exec(f);
    if (!m) continue;
    nextId = Math.max(nextId, idNum(m[1]) + 1);
    if (known.has(m[1])) continue;
    try {
      const rec = JSON.parse(await fsp.readFile(path.join(playersDir, f), 'utf8'));
      if (rec.tokenHash) {
        tokens.set(rec.tokenHash, m[1]);
        await fsp.appendFile(tokensLog, `${rec.tokenHash} ${m[1]}\n`);
        repaired++;
      }
    } catch (err) {
      log.warn('player file unreadable', { file: f, err });
    }
  }
  if (repaired) log.info('token index repaired', { repaired });

  async function readJson(file) {
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async function loadRecord(id) {
    if (records.has(id)) return records.get(id);
    const rec = await readJson(playerFile(id));
    if (rec) records.set(id, rec);
    return rec || null;
  }

  const pub = (rec) =>
    rec && { id: rec.id, name: rec.name, appearance: rec.appearance ?? null, save: rec.save ?? null, createdAt: rec.createdAt, lastSeen: rec.lastSeen };

  return {
    kind: 'json',
    dir,

    async loadWorld() {
      for (const file of [worldFile, prevFile]) {
        let raw;
        try {
          raw = await fsp.readFile(file, 'utf8');
        } catch (err) {
          if (err.code === 'ENOENT') continue;
          throw err;
        }
        try {
          const doc = JSON.parse(raw);
          if (file === prevFile) log.warn('world.json missing or corrupt — loaded world.prev.json');
          return doc?.data ?? null;
        } catch (err) {
          const keep = `${file}.corrupt-${Date.now()}`;
          await fsp.copyFile(file, keep).catch(() => {});
          log.error('world save corrupt, kept a copy', { file: path.basename(file), keep: path.basename(keep), err });
        }
      }
      return null;
    },

    async worldUpdatedAt() {
      try {
        return (await fsp.stat(worldFile)).mtimeMs;
      } catch {
        return 0;
      }
    },

    saveWorld(data) {
      return q.run('world', async () => {
        if (worldSaves++ % 10 === 0 && fs.existsSync(worldFile)) await fsp.copyFile(worldFile, prevFile).catch(() => {});
        await writeAtomic(worldFile, JSON.stringify({ v: 1, id: 'world', updatedAt: Date.now(), data }));
      });
    },

    async getPlayerByToken(hash) {
      const id = tokens.get(hash);
      if (!id) return null;
      return q.run(id, async () => {
        const rec = await loadRecord(id);
        return rec && rec.tokenHash === hash ? pub(rec) : null;
      });
    },

    createPlayer({ tokenHash, name, appearance = null }) {
      const id = `p${nextId++}`;
      const now = Date.now();
      const rec = { id, tokenHash, name, appearance, save: null, createdAt: now, lastSeen: now };
      records.set(id, rec);
      tokens.set(tokenHash, id);
      return q.run(id, async () => {
        await writeAtomic(playerFile(id), JSON.stringify(rec));
        await fsp.appendFile(tokensLog, `${tokenHash} ${id}\n`);
        return pub(rec);
      });
    },

    /** Partial update: only the given fields of { name, appearance, save } change; lastSeen = now. */
    savePlayer(id, data = {}) {
      return q.run(id, async () => {
        const rec = await loadRecord(id);
        if (!rec) throw new Error(`unknown player ${id}`);
        if (data.name !== undefined) rec.name = data.name;
        if (data.appearance !== undefined) rec.appearance = data.appearance;
        if (data.save !== undefined) rec.save = data.save;
        rec.lastSeen = Date.now();
        await writeAtomic(playerFile(id), JSON.stringify(rec));
      });
    },

    /** Forget the in-memory copy of a player that went offline (the file stays the truth). */
    release(id) {
      q.run(id, async () => records.delete(id));
    },

    stats() {
      return { kind: 'json', players: tokens.size };
    },

    async close() {
      await q.idle();
    },
  };
}
