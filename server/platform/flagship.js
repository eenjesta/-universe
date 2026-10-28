/**
 * The built-in flagship experience: the shared SMP hub world. Its listing is
 * defined here (bilingual, updated with the code); the store only keeps a
 * seeded counter row (plays / likes) under the same id, which list queries skip.
 */
export const FLAGSHIP_ID = 'o-universe';

export const FLAGSHIP = {
  id: FLAGSHIP_ID,
  kind: 'smp',
  title: { en: 'Ø Universe — SMP', nl: 'Ø Universe — SMP' },
  description: {
    en: 'One seamless planet for up to 50 players. Meet friends in the safe hub city at its heart, then head out into the endless wilds: gather and craft, claim land, build your base anywhere and survive the drones and jungle stalkers that come out at night.',
    nl: 'Eén naadloze planeet voor maximaal 50 spelers. Ontmoet vrienden in de veilige hubstad in het hart, trek dan de eindeloze wildernis in: verzamel en maak spullen, claim land, bouw overal je basis en overleef de drones en junglejagers die \'s nachts tevoorschijn komen.',
  },
  creator: { id: null, username: 'o_universe', displayName: 'Ø Universe' },
  maxPlayers: 50,
  tags: ['smp', 'survival', 'multiplayer', 'social', 'official'],
  createdAt: Date.UTC(2026, 9, 1),
};

/** Counter row for the store (title/description here are informational only). */
export function flagshipSeed(now = Date.now()) {
  return {
    id: FLAGSHIP_ID,
    ownerId: null,
    ownerName: null,
    title: FLAGSHIP.title.en,
    description: FLAGSHIP.description.en,
    maxPlayers: FLAGSHIP.maxPlayers,
    builtin: true,
    version: 1,
    plays: 0,
    likes: 0,
    partCount: 0,
    size: 0,
    thumbRev: 0,
    draftSavedAt: null,
    createdAt: FLAGSHIP.createdAt,
    updatedAt: now,
    publishedAt: FLAGSHIP.createdAt,
  };
}

/** True when a search query should list the flagship. */
export function flagshipMatches(q) {
  const ql = q.toLowerCase();
  return [FLAGSHIP.title.en, FLAGSHIP.title.nl, FLAGSHIP.description.en, FLAGSHIP.description.nl, 'smp', 'survival', 'o universe', 'universe']
    .some((s) => s.toLowerCase().includes(ql));
}
