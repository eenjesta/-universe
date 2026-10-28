/**
 * Platform store factory + interface (both implementations are async and
 * interchangeable; tests run one conformance suite against both).
 *
 *   const store = await createStore({ dataDir, databaseUrl, log, pgPool?, tablePrefix? })
 *   // DATABASE_URL set → Postgres (tables auto-created), else JSON files in DATA_DIR/platform/
 *
 * Records (camelCase in JS, snake_case columns in Postgres):
 *   user        { id, username, passwordHash, birthYear, guestTokenHash|null, guestLinkedAt|null,
 *                 restrictions: { chat?, friends? }|null (null = by age), createdAt, updatedAt }
 *   session     { tokenHash, userId, createdAt, expiresAt, lastUsedAt }
 *   friendship  { lo, hi (lo < hi), requester, status: 'pending'|'accepted', createdAt, acceptedAt|null }
 *   experience  { id, ownerId|null, ownerName|null, title, description, maxPlayers, builtin, version (latest
 *                 published, 0 = never), plays, likes, partCount, size (of the latest version), thumbRev (0 = none),
 *                 draftSavedAt|null, createdAt, updatedAt, publishedAt|null }
 *   draft       { data, savedAt, size, partCount }
 *   version     { v, data, createdAt, size, partCount }   — immutable once written
 *   report      { id, kind, targetId, reason, details, context, reporterId|null, reporterIp, status, createdAt }
 *
 * Methods:
 *   init() · flush() · close() · kind ('json' | 'postgres')
 *   createUser(u) (throws StoreConflict 'name_taken' | 'guest_linked') · getUser(id) · getUserByName(name)
 *   getUserByGuestHash(hash) · getUsers(ids) · updateUser(id, { passwordHash?, restrictions?, updatedAt })
 *   createSession(s) · getSession(hash) · touchSession(hash, lastUsedAt, expiresAt) · deleteSession(hash)
 *   deleteUserSessions(userId) · pruneSessions(now)
 *   getFriendship(a, b) · listFriendships(userId) · putFriendship(rec) (upsert) · deleteFriendship(a, b) → bool
 *   ensureExperience(meta) · createExperience(meta, draft|null) · getExperience(id)
 *   updateExperience(id, { title, description, maxPlayers, updatedAt }) · saveDraft(id, draft, metaPatch)
 *   getDraft(id) · setThumbnail(id, dataUrl|null, rev) · getThumbnail(id) → { dataUrl, rev } | null
 *   publishVersion(id, { data, size, partCount, createdAt }, keep) → { meta, version } (keeps the last `keep`)
 *   getVersion(id, v) · listVersions(id) (newest first, without data) · deleteExperience(id) → bool (cascades)
 *   listExperiences({ sort: 'popular'|'new'|'updated', q, ownerId, includeUnpublished, limit, offset }) → { items, hasMore }
 *     (never returns builtin rows) · countExperiences(ownerId) · addPlays(id, n) → plays
 *   setLike(id, userId, on, at) → { changed, likes } | null · likedBy(userId, ids) → Set
 *   addReport(r) · listReports({ limit })
 */
import { createJsonStore } from './json.js';

export async function createStore({ dataDir, databaseUrl, log, pgPool, tablePrefix = '', flushMs } = {}) {
  let store;
  if (databaseUrl || pgPool) {
    const { createPgStore } = await import('./pg.js');
    store = await createPgStore({ databaseUrl, log, pool: pgPool, tablePrefix });
  } else {
    if (!dataDir) throw new Error('platform store: dataDir or databaseUrl required');
    store = createJsonStore({ dataDir, log, flushMs });
  }
  try {
    await store.init();
  } catch (err) {
    await store.close?.().catch(() => {});
    throw err;
  }
  return store;
}

export { createJsonStore };
