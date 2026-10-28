import { createJsonStore } from './json.js';
import { createPgStore } from './pg.js';

/**
 * Store factory (PLATFORM.md §5): Postgres when DATABASE_URL is set, otherwise
 * JSON files in DATA_DIR.
 *
 * Interface (all async):
 *   loadWorld() → data | null          saveWorld(data)          worldUpdatedAt() → ms
 *   getPlayerByToken(hash) → { id, name, appearance, save, createdAt, lastSeen } | null
 *   createPlayer({ tokenHash, name, appearance }) → same record (id = 'p<n>')
 *   savePlayer(id, { name?, appearance?, save? })   (partial; bumps lastSeen)
 *   release(id)  (sync, optional cache drop)   stats()   close()
 */
export async function createStore({ databaseUrl, dataDir, log }) {
  if (databaseUrl) return createPgStore({ url: databaseUrl, log });
  return createJsonStore({ dir: dataDir, log });
}
