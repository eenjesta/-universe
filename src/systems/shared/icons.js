/**
 * Extra line icons used by the systems module (quests, market, events, chat).
 * Same style as src/ui/icons.js: 24×24 viewBox, stroke = currentColor.
 */
import { registerIcons } from '../../ui/icons.js';

export function registerSystemIcons() {
  registerIcons({
    // quest diamond (◈) — tracker, markers, journal
    'sys-diamond': '<path d="M12 2.6 21.4 12 12 21.4 2.6 12Z"/><path d="M12 8.1 15.9 12 12 15.9 8.1 12Z" fill="currentColor" stroke="none"/>',
    'sys-diamond-check': '<path d="M12 2.6 21.4 12 12 21.4 2.6 12Z"/><path d="m8.6 12.2 2.3 2.3 4.6-4.8"/>',
    // discovery hexagon
    'sys-hex': '<path d="M12 2.8 19.97 7.4v9.2L12 21.2l-7.97-4.6V7.4Z"/><path d="M12 7.7 15.7 9.85v4.3L12 16.3l-3.7-2.15v-4.3Z"/>',
    // Ø-credit coin
    'sys-credit': '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="3.9"/><path d="M8.2 15.8 15.8 8.2"/>',
    'sys-heart': '<path d="M12 19.5s-7.5-4.6-7.5-10.1A4.1 4.1 0 0 1 12 7.1a4.1 4.1 0 0 1 7.5 2.3c0 5.5-7.5 10.1-7.5 10.1Z"/>',
    'sys-heart-fill': '<path d="M12 19.5s-7.5-4.6-7.5-10.1A4.1 4.1 0 0 1 12 7.1a4.1 4.1 0 0 1 7.5 2.3c0 5.5-7.5 10.1-7.5 10.1Z" fill="currentColor"/>',
    // live-audio waveform (event banner)
    'sys-wave': '<path d="M3.5 10.5v3M7 7.5v9M10.5 4.5v15M14 8v8M17.5 6v12M21 10.5v3"/>',
    'sys-meteor': '<circle cx="16.4" cy="16.4" r="3.4"/><path d="M13.9 13.9 4 4M12.5 17.3 7 11.8M17.3 12.5 11.8 7"/>',
    'sys-flag': '<path d="M5.5 21V4M5.5 4.5h11l-2.2 3.8 2.2 3.8h-11"/>',
    'sys-level': '<path d="m6 13.5 6-6 6 6M6 19l6-6 6 6"/>',
    'sys-send': '<path d="M20.5 3.5 3.5 10.8l6.6 2.6 2.6 6.6Z"/><path d="m10.1 13.4 5.2-5.2"/>',
    'sys-lock': '<rect x="5.5" y="10.5" width="13" height="10" rx="2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/>',
    'sys-shirt': '<path d="M8.5 3.8 4 6.5l1.8 4.2 2.2-.9V20.5h8V9.8l2.2.9L20 6.5l-4.5-2.7c-.6 1.6-1.9 2.5-3.5 2.5s-2.9-.9-3.5-2.5Z"/>',
    'sys-brush': '<path d="M14.5 4.5 19.5 9.5 11 18l-5-5Z"/><path d="M6 13c-2 0-3 1.5-3 3.5V20h3.5c2 0 3.5-1 3.5-3"/>',
    'sys-blueprint': '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M8.5 9.5v10M12 13h5M12 16h3"/>',
    'sys-clock': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>',
    'sys-music': '<path d="M9 18.5V6l10-2v12.5"/><circle cx="6.8" cy="18.5" r="2.2"/><circle cx="16.8" cy="16.5" r="2.2"/>',
    'sys-scroll': '<path d="M7 4.5h10.5a2 2 0 0 1 2 2V8h-3.5"/><path d="M16 8v10.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V17H14"/><path d="M7 4.5a2 2 0 0 0-2 2V17M9 9h4.5M9 12.5h4.5"/>',
    'sys-route': '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
  });
}
