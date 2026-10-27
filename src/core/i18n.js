/**
 * Player-facing text (i18n). English is the default language; Dutch ('nl')
 * can be chosen in the settings (state.settings.language) or with ?lang=nl.
 * Text lives inline, next to the code that uses it:
 *
 *   import { t, pick } from '../core/i18n.js';
 *   t({ en: 'Talk to Aria', nl: 'Praat met Aria' })        → string in the active language
 *   t({ en: '{n} m away', nl: 'nog {n} m' }, { n: 42 })    → {placeholders}
 *   t('Ø Universe')                                        → plain strings pass through
 *   pick({ en: ['Hi!', 'Hello'], nl: ['Hoi!', 'Hallo'] })  → any value (arrays, objects)
 *
 * Every new player-facing string must provide `en` (required) and `nl`.
 * Missing translations fall back to English. Changing the language reloads
 * the page (setLanguage), so modules may resolve their text once at install.
 * Also available as ctx.i18n = { t, pick, lang, locale, setLanguage, LANGUAGES }.
 */

export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'nl', label: 'Nederlands' },
];

let current = 'en';

const isText = (v) => v && typeof v === 'object' && !Array.isArray(v) && ('en' in v || 'nl' in v);

/** Active language id ('en' | 'nl'). */
export const lang = () => current;

/** BCP-47 locale for number/date formatting. */
export const locale = () => (current === 'nl' ? 'nl-NL' : 'en-US');

/** Sets the active language (called once by the game before modules install). */
export function initLanguage(id) {
  current = LANGUAGES.some((l) => l.id === id) ? id : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  return current;
}

/** Resolves a bilingual {en, nl} value (or a plain string) to text, with {placeholders}. */
export function t(text, vars = null) {
  let s = isText(text) ? text[current] ?? text.en ?? '' : text;
  s = s == null ? '' : String(s);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
  return s;
}

/** Like t() but returns the raw variant (arrays of lines, objects…); other values pass through. */
export function pick(value) {
  return isText(value) ? value[current] ?? value.en : value;
}

/** Switches the language: saves it in the settings and reloads the page. */
export function setLanguage(id, state = null) {
  if (!LANGUAGES.some((l) => l.id === id) || id === current) return;
  try {
    state?.set?.('settings.language', id);
    state?.save?.();
  } catch {
    /* ignore — the URL parameter below still switches */
  }
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) url.searchParams.set('lang', id);
  location.href = url.toString();
}

export const i18n = { t, pick, lang, locale, setLanguage, LANGUAGES };
