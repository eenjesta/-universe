/**
 * SMP icons: line icons (24×24, stroke currentColor, registered with
 * registerIcons) + filled illustrations (ART, viewBox 0 0 120 64) for the
 * weapon / supply cards of the inventory screen (dark metal, glowing cyan
 * energy parts — the 26_loadout_screen look, procedural SVG).
 */
import { registerIcons } from '../ui/icons.js';
import { ITEMS, RESOURCES } from '../../shared/defs/items.js';

export const SMP_ICONS = {
  'smp-bag': '<path d="M6 8.5h12l1 11.5H5Z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/><path d="M9 13h6"/>',
  'smp-pistol': '<path d="M3.5 8h14l1.5 2v2h-9l-1.5 6.5H5l1-6.5H3.5Z"/><path d="M19 10h1.5"/><path d="M12 12v2.2h-2"/>',
  'smp-rifle': '<path d="M2.5 9.5h15.5l3.5 1.5v2H13l-1.2 3.2H9.4l.8-3.2H6.5L4 15H2.5Z"/><path d="M8 9.5V8h5v1.5"/><path d="M14.5 11.2h3"/>',
  'smp-railgun': '<path d="M2 11h16.5M2 13.5h20"/><path d="M5 11V9h9v2M8 13.5 7 17h2.6l1-3.5"/><path d="M15.5 13.5v-2.5"/>',
  'smp-grenade': '<circle cx="12" cy="13.5" r="6"/><path d="M9.5 7.5h5V5.5h-5ZM14.5 6.5h3"/><path d="M8.6 12.2a3.6 3.6 0 0 1 3-2.6"/>',
  'smp-ration': '<rect x="5" y="7" width="14" height="12" rx="2"/><path d="M5 10.5h14"/><path d="M9 4.5h6v2.5H9Z"/><path d="M10 14h4"/>',
  'smp-medkit': '<rect x="3.5" y="7" width="17" height="12.5" rx="2"/><path d="M9 7V5h6v2"/><path d="M12 10.2v6M9 13.2h6"/>',
  'smp-shield': '<path d="M12 3.5 19 6v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6Z"/><path d="m12.8 7.8-3 4.6h3.6l-1.2 4"/>',
  'smp-ammo': '<path d="M6.5 9.5h4v10h-4ZM13.5 9.5h4v10h-4Z"/><path d="M6.5 9.5 8.5 4.5l2 5M13.5 9.5l2-5 2 5"/>',
  'smp-crate': '<path d="M3.5 8.5 12 4l8.5 4.5v8L12 21l-8.5-4.5Z"/><path d="M3.5 8.5 12 13l8.5-4.5M12 13v8"/>',
  'smp-claim': '<path d="M12 21V9"/><circle cx="12" cy="6" r="3"/><path d="M9.6 8.4 14.4 3.6"/><path d="M4 18.5c1.8 1.6 4.8 2.5 8 2.5s6.2-.9 8-2.5" stroke-dasharray="2 2.2"/>',
  'smp-workbench': '<path d="M3 10.5h18M5 10.5V20M19 10.5V20M5 15.5h14"/><path d="M7 10.5V4.5h10v6"/><path d="M10 7.5h4"/>',
  'smp-skull': '<path d="M12 3.5c-4.4 0-7.5 3-7.5 7 0 2.4 1.1 4 2.8 5v3h9.4v-3c1.7-1 2.8-2.6 2.8-5 0-4-3.1-7-7.5-7Z"/><circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/><path d="M10.5 18.5v-2M13.5 18.5v-2"/>',
  'smp-energy': '<path d="M13 3.5 6.5 13H12l-1 7.5L17.5 11H12Z"/>',
  'smp-spawn': '<ellipse cx="12" cy="17" rx="8.5" ry="3"/><path d="M12 14V4M8.5 7.5 12 4l3.5 3.5"/>',
  'smp-tip': '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>',
  'smp-safe': '<path d="M12 3.5 19 6v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6Z"/><circle cx="12" cy="11.5" r="3.2"/><path d="m9.6 14.3 4.8-5.6"/>',
  'smp-wild': '<path d="m2.5 19.5 6-9.5 3.5 5 2.5-3.5 7 8Z"/><path d="M8.5 10 10 7.5l1.5 2.5"/><circle cx="17.5" cy="5.5" r="1.8"/>',
  'smp-craft': '<path d="M14.5 4.5 19.5 9.5 9.5 19.5H4.5v-5Z"/><path d="M12 7l5 5"/>',
  // ---- food, materials, gear, schematics (survival depth)
  'smp-food': '<path d="M7 3.5v6.5a2 2 0 0 0 4 0V3.5M9 3.5V21"/><path d="M16.5 21V3.5c-2 1.2-3 3.6-3 6.5 0 2 1 3 3 3"/>',
  'smp-berries': '<circle cx="8.5" cy="14.5" r="3.2"/><circle cx="15.5" cy="14.5" r="3.2"/><circle cx="12" cy="9.5" r="3.2"/><path d="M12 6.3V3.5M12 4.5c1.2-1.4 3-1.6 4.5-1"/>',
  'smp-mushroom': '<path d="M3.5 12.5C3.5 7.8 7.3 4.5 12 4.5s8.5 3.3 8.5 8Z"/><path d="M9.5 12.5v6a2.5 2.5 0 0 0 5 0v-6"/><circle cx="9" cy="8.8" r=".9"/><circle cx="14.5" cy="7.8" r=".9"/>',
  'smp-fruit': '<path d="M12 7.5c4 0 6.5 3 6.5 6.5S15.7 20.5 12 20.5 5.5 17.5 5.5 14 8 7.5 12 7.5Z"/><path d="M12 7.5c0-2 .8-3.4 2.5-4M12 6c-1.5-1.8-3.6-2-5-1.5 1 1.6 2.8 2.3 5 1.5Z"/>',
  'smp-meat': '<path d="M14.5 4c3.6 0 6 2.6 6 5.8 0 4.2-4 7.7-8.6 7.7-1.6 0-2.4.7-3.2 1.8a2.2 2.2 0 1 1-3-3c1.1-.8 1.8-1.6 1.8-3.2C7.5 8 10.8 4 14.5 4Z"/><circle cx="14.5" cy="10" r="2"/>',
  'smp-meat-cooked': '<path d="M14.5 4c3.6 0 6 2.6 6 5.8 0 4.2-4 7.7-8.6 7.7-1.6 0-2.4.7-3.2 1.8a2.2 2.2 0 1 1-3-3c1.1-.8 1.8-1.6 1.8-3.2C7.5 8 10.8 4 14.5 4Z"/><path d="m11 9.5 5-3M11.5 13l6-3.6"/>',
  'smp-meal': '<path d="M3.5 12.5h17a8.5 8.5 0 0 1-17 0Z"/><path d="M9 9.5c-.8-1.2.8-1.8 0-3.2M13 9.5c-.8-1.2.8-1.8 0-3.2M17 9.5c-.8-1.2.8-1.8 0-3.2"/>',
  'smp-skewer': '<path d="M3.5 20.5 20.5 3.5"/><circle cx="8.5" cy="15.5" r="2.3"/><circle cx="12.5" cy="11.5" r="2.3"/><circle cx="16.3" cy="7.7" r="2"/>',
  'smp-tea': '<path d="M5 9.5h11v5a5.5 5.5 0 0 1-11 0Z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H15.5"/><path d="m10.5 2.5 1.6 2.6-1.6 2.4-1.6-2.4Z"/>',
  'smp-stew': '<path d="M4 11.5h16v2.5a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6Z"/><path d="M2.5 11.5h19M9 8.5c-.8-1.2.8-1.8 0-3.2M15 8.5c-.8-1.2.8-1.8 0-3.2"/>',
  'smp-fiber': '<path d="M6 20.5c1-5 .5-11-2-16M10 20.5c.5-5 1.5-10 5-15M14 20.5c0-4 1.5-8 5.5-11"/><path d="M4 16h14.5"/>',
  'smp-crystal': '<path d="m12 2.5 5 6-5 13-5-13Z"/><path d="M7 8.5h10M12 2.5v19"/>',
  'smp-bandage': '<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-35 12 12)"/><path d="m10.2 10.5 3.6 3M12.5 9.2l1.2 1.2M10.3 13.4l1.2 1.2"/>',
  'smp-armor': '<path d="M8 3.5 5 5v6l2 9.5h10L19 11V5l-3-1.5-1.5 2.5h-5Z"/><path d="M9.5 6v5.5h5V6M12 11.5v9"/>',
  'smp-armor-heavy': '<path d="M8 3.5 4.5 5v6.5L7 20.5h10l2.5-9V5L16 3.5l-1.5 2.5h-5Z"/><path d="M4.5 11.5h15M7.5 15.5h9M12 6v14.5"/>',
  'smp-module': '<path d="m12 2.5 8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5Z"/><path d="M12 7.5 15.5 9.5v5L12 16.5 8.5 14.5v-5Z"/>',
  'smp-module-2': '<path d="m12 2.5 8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5Z"/><path d="M9.5 9v6M14.5 9v6"/>',
  'smp-schematic': '<path d="M6 3.5h9l3.5 3.5v13.5H6Z"/><path d="M15 3.5V7h3.5"/><path d="M8.5 11h7M8.5 14h7M8.5 17h4"/>',
  'smp-grenade': '<circle cx="12" cy="13.5" r="6"/><path d="M9.5 7.5h5V5.5h-5ZM14.5 6.5h3"/>',
  // ---- buffs + base structures
  'smp-buff-fed': '<path d="M3.5 12.5h17a8.5 8.5 0 0 1-17 0Z"/><path d="m9 9.5 1.5-5M14 9.5l-1-5"/>',
  'smp-buff-swift': '<path d="M13 3.5 6.5 13H12l-1 7.5L17.5 11H12Z"/><path d="M2.5 9h3M2 13.5h2.5M3 18h3"/>',
  'smp-buff-charged': '<path d="M12 3.5 19 6v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6Z"/><path d="m12.8 7.8-3 4.6h3.6l-1.2 4"/>',
  'smp-buff-rested': '<path d="M15.5 4.5A7.5 7.5 0 1 0 19.5 15 6 6 0 0 1 15.5 4.5Z"/><path d="M17 3h3l-3 3h3"/>',
  'smp-buff-warm': '<path d="M12 21c-3.6 0-5.8-2.4-5.8-5.4 0-3.5 2.8-5.2 3.5-8.9 2.3 1.7 2.9 3.8 2.7 5.5 1.3-.7 2.2-2 2.5-3.4 2 1.9 2.9 4 2.9 6.6C17.8 18.7 15.5 21 12 21Z"/>',
  'smp-buff-cold': '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="m9.5 4 2.5 2 2.5-2M9.5 20l2.5-2 2.5 2"/>',
  'smp-campfire': '<path d="M4 20.5 20 16M4 16l16 4.5"/><path d="M12 15.5c-2.6 0-4-1.7-4-3.8 0-2.4 2-3.6 2.4-6.2 1.6 1.2 2 2.6 1.9 3.8.9-.5 1.5-1.4 1.7-2.4 1.4 1.3 2 2.8 2 4.6 0 2.3-1.6 4-4 4Z"/>',
  'smp-chest': '<rect x="3.5" y="9.5" width="17" height="10" rx="1.2"/><path d="M3.5 9.5 5 5.5h14l1.5 4M3.5 13h17"/><path d="M11 12h2v2.5h-2Z"/>',
  'smp-bed': '<path d="M3 18.5V7M3 13.5h18v5M21 18.5V12a2.5 2.5 0 0 0-2.5-2.5H11v4"/><circle cx="7" cy="11" r="1.8"/>',
  'smp-door': '<path d="M5 20.5V4.5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v16"/><path d="M3 20.5h18M8.5 6.5h7v14h-7Z"/><circle cx="14" cy="13.5" r=".9"/>',
  'smp-lock': '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/>',
  'smp-gear': '<path d="M8 3.5 5 5v6l2 9.5h10L19 11V5l-3-1.5-1.5 2.5h-5Z"/>',
};

/** Icon name of an item / resource / ammo id (ITEMS[id].icon wins; tools register their own `tool-*` icons). */
export function itemIcon(id) {
  return ITEMS[id]?.icon || ICON_OF[id] || RESOURCES[id]?.icon || 'smp-bag';
}

const DEFS = `
<defs>
  <linearGradient id="smpMetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a616d"/><stop offset=".55" stop-color="#2a2f37"/><stop offset="1" stop-color="#15181d"/></linearGradient>
  <linearGradient id="smpMetal2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9ced6"/><stop offset="1" stop-color="#6b717b"/></linearGradient>
  <linearGradient id="smpGlow" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3fb8e8"/><stop offset=".5" stop-color="#bdf3ff"/><stop offset="1" stop-color="#3fb8e8"/></linearGradient>
  <radialGradient id="smpHalo"><stop offset="0" stop-color="#7fe0ff" stop-opacity=".55"/><stop offset="1" stop-color="#7fe0ff" stop-opacity="0"/></radialGradient>
</defs>`;

const svg = (body) => `<svg viewBox="0 0 120 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${DEFS}${body}</svg>`;

/** Card illustrations (procedural, filled). */
export const ART = {
  'pulse-pistol': svg(`
    <ellipse cx="62" cy="34" rx="44" ry="20" fill="url(#smpHalo)" opacity=".5"/>
    <path d="M24 22h58l8 5v8H58l-5 19H40l4-19H30l-6-4Z" fill="url(#smpMetal)" stroke="#0b0d11" stroke-width="1.2"/>
    <path d="M30 22h46v4H30Z" fill="url(#smpMetal2)" opacity=".85"/>
    <rect x="58" y="27" width="22" height="5" rx="2.5" fill="url(#smpGlow)"/>
    <path d="M90 27h8v6h-8Z" fill="#20252c" stroke="#0b0d11"/>
    <circle cx="97" cy="30" r="2.2" fill="#bdf3ff"/>
    <path d="M44 35l-1 8h6" fill="none" stroke="#7fe0ff" stroke-width="1.5" opacity=".7"/>`),
  'plasma-rifle': svg(`
    <ellipse cx="60" cy="32" rx="54" ry="22" fill="url(#smpHalo)" opacity=".45"/>
    <path d="M8 26h12l4-4h62l12 4h12v8H98l-6 4H62l-6 16H44l4-16H30l-12 10H8l4-10H8Z" fill="url(#smpMetal)" stroke="#0b0d11" stroke-width="1.2"/>
    <path d="M30 22h50v4H30Z" fill="url(#smpMetal2)" opacity=".8"/>
    <rect x="48" y="27" width="34" height="7" rx="3.5" fill="url(#smpGlow)"/>
    <path d="M50 28.5h30" stroke="#ffffff" stroke-width="1" opacity=".7"/>
    <path d="M36 16h18v6H36Z" fill="#20252c" stroke="#0b0d11"/>
    <circle cx="40" cy="19" r="2" fill="#7fe0ff"/>
    <rect x="104" y="27" width="6" height="5" fill="#bdf3ff" opacity=".9"/>`),
  railgun: svg(`
    <ellipse cx="60" cy="32" rx="56" ry="18" fill="url(#smpHalo)" opacity=".4"/>
    <path d="M4 28h14l6-6h40l6 4h46v4H70l-4 4H44l-6 14H28l4-14H20L10 38H4l4-6Z" fill="url(#smpMetal)" stroke="#0b0d11" stroke-width="1.2"/>
    <path d="M70 26h46v2H70Z" fill="url(#smpMetal2)"/>
    <path d="M70 30h46" stroke="url(#smpGlow)" stroke-width="2"/>
    <rect x="34" y="14" width="26" height="7" rx="3" fill="#20252c" stroke="#0b0d11"/>
    <circle cx="38" cy="17.5" r="2.2" fill="#7fe0ff"/>
    <rect x="44" y="26" width="18" height="5" rx="2.5" fill="url(#smpGlow)"/>
    <path d="M80 24v8M90 24v8M100 24v8" stroke="#0b0d11" stroke-width="1.4"/>`),
  'shock-grenade': svg(`
    <ellipse cx="60" cy="36" rx="30" ry="24" fill="url(#smpHalo)" opacity=".6"/>
    <circle cx="60" cy="36" r="17" fill="url(#smpMetal)" stroke="#0b0d11" stroke-width="1.2"/>
    <path d="M45 36h30" stroke="url(#smpGlow)" stroke-width="3"/>
    <circle cx="60" cy="36" r="7" fill="none" stroke="#7fe0ff" stroke-width="2"/>
    <circle cx="60" cy="36" r="2.6" fill="#bdf3ff"/>
    <rect x="54" y="14" width="12" height="6" rx="1.5" fill="url(#smpMetal2)" stroke="#0b0d11"/>
    <path d="M66 16h10l2 3" fill="none" stroke="#c9ced6" stroke-width="2"/>`),
  ration: svg(`
    <ellipse cx="60" cy="36" rx="34" ry="22" fill="url(#smpHalo)" opacity=".25"/>
    <rect x="40" y="18" width="40" height="34" rx="5" fill="#2b3038" stroke="#0b0d11" stroke-width="1.2"/>
    <rect x="40" y="18" width="40" height="9" rx="4" fill="#c9a45a"/>
    <rect x="46" y="33" width="28" height="12" rx="2" fill="#d8d2c6"/>
    <path d="M50 39h20" stroke="#2b3038" stroke-width="2"/>
    <rect x="52" y="12" width="16" height="7" rx="2" fill="url(#smpMetal2)"/>`),
  medkit: svg(`
    <ellipse cx="60" cy="36" rx="36" ry="22" fill="url(#smpHalo)" opacity=".25"/>
    <rect x="34" y="20" width="52" height="32" rx="5" fill="#d8d2c6" stroke="#0b0d11" stroke-width="1.2"/>
    <rect x="34" y="20" width="52" height="7" rx="4" fill="#9aa0a8"/>
    <path d="M60 30v16M52 38h16" stroke="#ff6a5e" stroke-width="5" stroke-linecap="round"/>
    <path d="M52 20v-5h16v5" fill="none" stroke="#2b3038" stroke-width="3"/>`),
  'shield-cell': svg(`
    <ellipse cx="60" cy="34" rx="30" ry="26" fill="url(#smpHalo)" opacity=".7"/>
    <path d="M60 8 82 16v16c0 13-9 22-22 26-13-4-22-13-22-26V16Z" fill="url(#smpMetal)" stroke="#0b0d11" stroke-width="1.2"/>
    <path d="M60 15 76 21v11c0 9-6 15.5-16 19-10-3.5-16-10-16-19V21Z" fill="#0d2430" stroke="#7fe0ff" stroke-width="1.6"/>
    <path d="m63 22-8 12h9l-4 11" fill="none" stroke="#bdf3ff" stroke-width="2.4" stroke-linejoin="round"/>`),
};

/** def icon names (shared/defs) → our icon ids. */
export const ICON_OF = {
  'pulse-pistol': 'smp-pistol',
  'plasma-rifle': 'smp-rifle',
  railgun: 'smp-railgun',
  'shock-grenade': 'smp-grenade',
  ration: 'smp-ration',
  medkit: 'smp-medkit',
  'shield-cell': 'smp-shield',
  pulse: 'smp-ammo',
  plasma: 'smp-ammo',
  rail: 'smp-ammo',
  workbench: 'smp-workbench',
};

export function registerSmpIcons() {
  registerIcons(SMP_ICONS);
}
