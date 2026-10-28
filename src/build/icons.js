/**
 * Build module line icons (24×24, stroke = currentColor, 1.6 px, round),
 * registered at install with registerIcons(): one per catalog piece plus a
 * few HUD glyphs (lock, left mouse button).
 */
import { registerIcons } from '../ui/icons.js';

export const BUILD_ICONS = {
  'bld-foundation': '<path d="M3 12.5 12 8l9 4.5L12 17Z"/><path d="M3 12.5V15l9 4.5 9-4.5v-2.5"/>',
  'bld-cube': '<path d="m12 3 7.8 4.5v9L12 21l-7.8-4.5v-9Z"/><path d="M4.2 7.5 12 12l7.8-4.5M12 12v9"/>',
  'bld-stairs': '<path d="M4 20h4v-4h4v-4h4V8h4V4"/>',
  'bld-pillar': '<path d="M8.5 4h7M8.5 20h7M10 4v16M14 4v16"/>',
  'bld-tower': '<path d="M8 21V6.5l4-3.5 4 3.5V21"/><path d="M6 21h12M8 10h8M8 14h8M8 18h8"/>',
  'bld-pad': '<circle cx="12" cy="12" r="8.5"/><path d="M9.2 8v8M14.8 8v8M9.2 12h5.6"/>',
  'bld-workshop': '<path d="M3 20V9.5l9-5 9 5V20"/><path d="M7 20v-7h10v7M7 15.5h10"/>',
  'bld-wall': '<path d="M4.5 5.5 12 3l7.5 2.5v13L12 21l-7.5-2.5Z"/><path d="M12 3v18"/>',
  'bld-glass-wall': '<rect x="4.5" y="4" width="15" height="16" rx="1"/><path d="M12 4v16M7 9.5l3-3M14.5 15l3-3"/>',
  'bld-window-wall': '<rect x="4.5" y="4" width="15" height="16" rx="1"/><rect x="7.5" y="7.5" width="9" height="6"/><path d="M12 7.5v6"/>',
  'bld-door-wall': '<rect x="4.5" y="4" width="15" height="16" rx="1"/><path d="M10 20v-9h4v9"/>',
  'bld-half-wall': '<rect x="4.5" y="12" width="15" height="8" rx="1"/><path d="M3 12h18"/>',
  'bld-floor': '<path d="M2.8 12.5 12 8l9.2 4.5L12 17Z"/><path d="M2.8 12.5v1.6L12 18.6l9.2-4.5v-1.6"/>',
  'bld-glass-floor': '<path d="M2.8 12.5 12 8l9.2 4.5L12 17Z"/><path d="M7.4 10.3l9.2 4.4M16.6 10.3l-9.2 4.4"/>',
  'bld-deck': '<path d="M2.8 12.5 12 8l9.2 4.5L12 17Z"/><path d="M5.1 11.4l9.2 4.5M7.4 10.2l9.2 4.5M9.7 9.1l9.2 4.5"/>',
  'bld-flat-roof': '<path d="M3 8.5h18v3H3Z"/><path d="M6 11.5V20h12v-8.5"/>',
  'bld-pitched-roof': '<path d="M2.8 13 12 6l9.2 7"/><path d="M5.5 11v7.5h13V11"/>',
  'bld-canopy': '<path d="M3 8h18"/><path d="M5 8v12M19 8v12M8 5v3M12 5v3M16 5v3"/>',
  'bld-planter': '<path d="M5 14h14l-1.5 6h-11Z"/><path d="M12 14c0-4 1.5-7 5-8-.2 3.5-2 6.5-5 8Zm0 0c0-3-1.4-5.3-4.5-6 0 3 1.5 5.2 4.5 6Z"/>',
  'bld-lamp': '<path d="M12 21V7.5M12 7.5h4"/><path d="M14.5 6.5h5l-1 2.5h-3Z"/><path d="M9 21h6"/>',
  'bld-bench': '<path d="M3 13h18M5.5 13v5M18.5 13v5M4 9h16"/>',
  'bld-table': '<path d="M3 9h18M6 9v10M18 9v10"/>',
  'bld-banner': '<path d="M6 21V3"/><path d="M6 4.5h11v9l-5.5-2.5L6 13.5"/>',
  'bld-brazier': '<path d="M6 12h12l-2 5H8Z"/><path d="M9 17l-2 4M15 17l2 4"/><path d="M12 10.5c-2-2-1-4 0-6 1 2 3 3.5 1 6"/>',
  'bld-crates': '<rect x="3" y="11" width="9" height="9"/><rect x="12" y="13" width="8.5" height="7"/><rect x="6" y="5" width="7" height="6"/>',
  'bld-statue': '<path d="M8 21h8M9.5 21v-3.5h5V21"/><circle cx="12" cy="10" r="4.5"/><path d="M7.5 15.5 16.5 4.5"/>',
  'bld-neon-tree': '<path d="M12 21v-6"/><circle cx="12" cy="9" r="5.5"/><path d="M9.5 9h.01M14 7.5h.01M12.5 11.5h.01"/>',
  'bld-solar': '<path d="M4 15 7 6h13l-3 9Z"/><path d="M5.5 10.5h13M10.5 6 9 15M15.5 6 14 15"/><path d="M11 15v5M8 20h6"/>',
  'bld-generator': '<rect x="3" y="7" width="18" height="11" rx="1.5"/><path d="M7 18v2M17 18v2"/><path d="M13 9.5 10 13h3l-1 3"/>',
  'bld-battery': '<rect x="7" y="4" width="10" height="17" rx="1.5"/><path d="M10 2.5h4"/><path d="M10 15h4M10 11.5h4M10 8h4"/>',
  'bld-mast': '<path d="M12 21V6"/><path d="M7.5 4h9"/><path d="M7.5 4l-1 3h3ZM16.5 4l-1 3h3Z"/><path d="M9 21h6"/>',
  'bld-survival': '<path d="M12 3.5 19 6v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6Z"/><path d="M12 8.5v7M8.5 12h7"/>',
  'bld-workbench': '<path d="M3 10.5h18M5 10.5V20M19 10.5V20M5 15.5h14"/><path d="M7 10.5V4.5h10v6"/><path d="M10 7.5h4"/>',
  'bld-claim': '<path d="M12 21V9"/><circle cx="12" cy="6" r="3"/><path d="M9.6 8.4 14.4 3.6"/><path d="M4 18.5c1.8 1.6 4.8 2.5 8 2.5s6.2-.9 8-2.5" stroke-dasharray="2 2.2"/>',
  'bld-spawn': '<ellipse cx="12" cy="17" rx="8.5" ry="3"/><path d="M12 14V4M8.5 7.5 12 4l3.5 3.5"/>',
  'bld-campfire': '<path d="M4 20.5 20 16M4 16l16 4.5"/><path d="M12 15.5c-2.6 0-4-1.7-4-3.8 0-2.4 2-3.6 2.4-6.2 1.6 1.2 2 2.6 1.9 3.8.9-.5 1.5-1.4 1.7-2.4 1.4 1.3 2 2.8 2 4.6 0 2.3-1.6 4-4 4Z"/>',
  'bld-bag': '<path d="M5 8.5c0-2 1.6-3.5 3.5-3.5h7c1.9 0 3.5 1.5 3.5 3.5V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z"/><path d="M5 11h14M8.5 7.5h7"/>',
  'bld-bed': '<path d="M3 18.5V7M3 13.5h18v5M21 18.5V12a2.5 2.5 0 0 0-2.5-2.5H11v4"/><circle cx="7" cy="11" r="1.8"/>',
  'bld-chest': '<rect x="3.5" y="9.5" width="17" height="10" rx="1.2"/><path d="M3.5 9.5 5 5.5h14l1.5 4M3.5 13h17"/><path d="M11 12h2v2.5h-2Z"/>',
  'bld-door': '<path d="M5 20.5V4.5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v16"/><path d="M3 20.5h18M8.5 6.5h7v14h-7Z"/><circle cx="14" cy="13.5" r=".9"/>',
  'bld-torch': '<path d="M10.5 21h3l.8-10.5H9.7Z"/><path d="M8.8 10.5h6.4"/><path d="M12 9c-1.8 0-2.8-1.2-2.8-2.6 0-1.6 1.4-2.6 1.6-4.4 1.2.9 1.4 1.9 1.3 2.7.6-.3 1-1 1.2-1.6 1 .9 1.5 2 1.5 3.3C14.8 7.8 13.6 9 12 9Z"/>',
  'bld-fusion': '<circle cx="12" cy="12" r="2.6"/><ellipse cx="12" cy="12" rx="9" ry="3.4"/><ellipse cx="12" cy="12" rx="9" ry="3.4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.4" transform="rotate(120 12 12)"/>',
  'bld-lock': '<rect x="5.5" y="10.5" width="13" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  'bld-mouse-left': '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 3v7M6.5 10h11"/><path d="M7.4 9.2V8.6A4.6 4.6 0 0 1 11.2 3.9v5.3Z" fill="currentColor" stroke="none"/>',
  'bld-mouse-right': '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 3v7M6.5 10h11"/><path d="M16.6 9.2V8.6A4.6 4.6 0 0 0 12.8 3.9v5.3Z" fill="currentColor" stroke="none"/>',
  'bld-wheel': '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 6.5v4"/><path d="m10.4 8 1.6-1.6L13.6 8M10.4 9.6 12 11.2l1.6-1.6" opacity=".6"/>',
  'bld-resources': '<path d="m12 3 7.8 4.5v9L12 21l-7.8-4.5v-9Z"/><path d="M4.2 7.5 12 12l7.8-4.5M12 12v9"/>',
};

export function registerBuildIcons() {
  registerIcons(BUILD_ICONS);
}
