/** Helpers shared by both platform stores (same ordering + search semantics everywhere). */

/** Popularity score: plays + likes weighted ×10. */
export const LIKE_WEIGHT = 10;
export const popularity = (m) => (m.plays || 0) + LIKE_WEIGHT * (m.likes || 0);

/** Canonical key of an unordered user pair. */
export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const pairOf = (a, b) => (a < b ? [a, b] : [b, a]);

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const desc = (a, b) => (b ?? -Infinity) - (a ?? -Infinity);

/**
 * Sort experience metas in place.
 *  popular: score desc → publishedAt desc → id
 *  new:     publishedAt desc → id
 *  updated: updatedAt desc → publishedAt desc → id   (owner lists incl. drafts)
 */
export function sortExperiences(items, sort) {
  items.sort((a, b) => {
    if (sort === 'popular') {
      const d = popularity(b) - popularity(a);
      if (d) return d;
    } else if (sort === 'updated') {
      const d = desc(a.updatedAt, b.updatedAt);
      if (d) return d;
    }
    return desc(a.publishedAt, b.publishedAt) || cmpStr(a.id, b.id);
  });
  return items;
}

/** Case-insensitive substring match on title, description or creator name (`ql` already lower-cased). */
export function matchesQuery(m, ql) {
  return (
    (m.title || '').toLowerCase().includes(ql) ||
    (m.description || '').toLowerCase().includes(ql) ||
    (m.ownerName || '').toLowerCase().includes(ql)
  );
}
