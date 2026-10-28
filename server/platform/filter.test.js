/** Text filter: bilingual bad words, obfuscation, false positives, PII, usernames. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterText, hasBadWords, hasPii, checkUsername } from './filter.js';

test('masks English and Dutch bad words, same length', () => {
  assert.equal(filterText('wat een KUT spel'), 'wat een *** spel');
  assert.equal(filterText('what the fuck'), 'what the ****');
  assert.equal(filterText('motherfuckers'), '*************');
  assert.equal(filterText('godverdomme zeg'), '*********** zeg');
  assert.equal(filterText('jij klootzak'), 'jij ********');
  assert.equal(filterText('shitty game'), '****** game');
  assert.equal(filterText('Kanker!').startsWith('******'), true);
  const s = 'een tering zooi';
  assert.equal(filterText(s).length, s.length);
});

test('obfuscation: leetspeak, spacing, stretching, accents, look-alikes', () => {
  for (const t of ['sh1t', 'f4ck'.replace('4', 'u'), 'f u c k', 'k.u.t', 's-h-i-t', 'fuuuuck', 'kuuut', 'Kút', 'b1tch', '5h1t', 'p0rn', 'аss' /* Cyrillic а */]) {
    assert.ok(hasBadWords(t), t);
  }
});

test('no false positives on ordinary words (Scunthorpe guard)', () => {
  for (const t of [
    'classic glass assassin', 'peacock pikachu', 'hoera, we winnen', 'cocktail party', 'Dickens novel', 'the bass is loud',
    'Season 2024-2025', 'assen en sluis', 'shipping ports', 'kutter', 'Middlesex', 'a b', 'I am a b c', 'grape', 'therapist',
    'Sky Race', 'Neon Obby', 'Block 12', 'Ø Universe — SMP', 'skull', 'compass',
  ]) {
    if (t === 'kutter') continue; // known accepted over-block (prefix rule), see below
    assert.equal(filterText(t), t, t);
  }
  // accepted over-blocking for a kids platform: prefix rules hit a few rare words
  assert.ok(hasBadWords('kutter'));
});

test('PII masking only when asked', () => {
  const t = 'mail me: a@b.nl or www.x.com, call 06-12345678';
  assert.equal(filterText(t), t);
  const m = filterText(t, { pii: true });
  assert.ok(!m.includes('@') && !m.includes('www') && !m.includes('12345678'), m);
  assert.ok(hasPii('add me on discord.gg/abc'));
  assert.ok(!hasPii('5000 parts and 2 MB'));
  assert.equal(filterText('Season 2024-2025', { pii: true }), 'Season 2024-2025');
});

test('usernames: ok, format, reserved, filtered', () => {
  for (const n of ['pikachu_7', 'peacock', 'alex_99', 'nazir', 'lulu', 'sk8er_boi', 'class_clown', 'titan_99', 'nova_rider']) assert.equal(checkUsername(n), null, n);
  for (const n of ['ab', 'x__y', '_abc', 'abc_', '1234', 'Upper', 'has space', 'a'.repeat(21)]) assert.equal(checkUsername(n), 'format', n);
  for (const n of ['admin', 'admin_jan', 'moderator7', 'system', 'ouniverse_staff', 'roblox_fan']) assert.equal(checkUsername(n), 'reserved', n);
  for (const n of ['peacockdick', 'pik_123', 'bigd1ck', 'dicks4life', 'f_u_c_k', 'kut_kid', 'abc12345678', 'xx_porn_xx', 'scunthorpe']) assert.equal(checkUsername(n), 'filtered', n);
});

test('non-strings pass through untouched', () => {
  assert.equal(filterText(''), '');
  assert.equal(filterText(null), null);
  assert.equal(filterText(undefined), undefined);
});
