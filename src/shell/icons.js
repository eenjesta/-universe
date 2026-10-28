/**
 * Shell icon set, registered into the shared icon registry at install
 * (24×24 viewBox, 1.6 px stroke = currentColor, same style as src/ui/icons.js).
 * Map places (19_world_map.png), mouse glyphs for key caps, menu actions.
 */
import { registerIcons } from '../ui/icons.js';

const SHELL_ICONS = {
  'shell-mountain': '<path d="M2.6 19.5 9.2 8l3.3 5.4 2.4-3.3 6.5 9.4Z"/><path d="m7.2 11.4 1.9 1.2 1.6-1.3"/>',
  'shell-binoculars':
    '<circle cx="6.6" cy="15.6" r="3.5"/><circle cx="17.4" cy="15.6" r="3.5"/><path d="M10.1 15.2h3.8M3.4 13.9 6 6h3.4l.9 7.4M20.6 13.9 18 6h-3.4l-.9 7.4M9.4 6V4.4h-3M14.6 6V4.4h3"/>',
  'shell-columns': '<path d="M3.3 8.6 12 4l8.7 4.6Z"/><path d="M5.6 10.2v7.2M9.9 10.2v7.2M14.1 10.2v7.2M18.4 10.2v7.2M3.6 20.2h16.8M4.6 17.6h14.8"/>',
  'shell-antenna':
    '<path d="m12 10.2-4 10.6M12 10.2l4 10.6M9.3 17.2h5.4M10.4 14h3.2"/><circle cx="12" cy="8.2" r="1.5"/><path d="M8.9 5.3a4.4 4.4 0 0 0 0 5.8M15.1 5.3a4.4 4.4 0 0 1 0 5.8M6.4 3a7.6 7.6 0 0 0 0 10.4M17.6 3a7.6 7.6 0 0 1 0 10.4"/>',
  'shell-waves':
    '<path d="M3 7.5c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0M3 12c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0M3 16.5c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/>',
  'shell-city':
    '<path d="M2.8 20.4h18.4M4.8 20.4v-7.6h2.9v7.6M7.7 20.4V9.2l1.9-1.6 1.9 1.6v11.2M11.5 20.4V3.6l2.4 2.2v14.6M13.9 20.4v-9.6h2.9v9.6M16.8 20.4v-5.6h2.4v5.6"/>',
  'shell-plane':
    '<path d="M12 2.8c.8 0 1.3.9 1.3 2.2v4.4l7 4.2v1.9l-7-2v4l2.2 1.7V21L12 20.2 8.5 21v-1.8l2.2-1.7v-4l-7 2v-1.9l7-4.2V5c0-1.3.5-2.2 1.3-2.2Z"/>',
  'shell-leaf': '<path d="M5.2 19c-.4-8.4 4.8-13.6 14.8-14.1.2 9.7-5.4 15.2-14.8 14.1Z"/><path d="M5.2 19C8 14.8 11 12 15 9.6"/>',
  'shell-canyon': '<path d="M2.5 19.6h19M3.6 19.6 6.2 11h4.3l1.4 8.6M13.4 19.6l1.7-11.2h4l1.6 11.2"/><path d="M6.6 14.6h3.2M15.5 12.4h3.4" opacity=".55"/>',
  'shell-fast': '<path d="m5.5 6.5 5.5 5.5-5.5 5.5M12.5 6.5 18 12l-5.5 5.5"/>',
  'shell-exit': '<path d="M13.5 4.5h-7v15h7"/><path d="M10.5 12h10M17 8.4l3.6 3.6-3.6 3.6"/>',
  'shell-wheel': '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 6.2v4.6"/><path d="m10.2 7.6 1.8-1.8 1.8 1.8M10.2 9.4l1.8 1.8 1.8-1.8" stroke-width="1.2"/>',
  'shell-lmb': '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 3v7.4H6.5"/><path d="M6.6 10.4V8.5c0-3 2.4-5.4 5.4-5.5v7.4Z" fill="currentColor" stroke="none" opacity=".8"/>',
  'shell-rmb': '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 3v7.4h5.5"/><path d="M17.4 10.4V8.5c0-3-2.4-5.4-5.4-5.5v7.4Z" fill="currentColor" stroke="none" opacity=".8"/>',
  'shell-diamond': '<path d="M12 3.2 20.8 12 12 20.8 3.2 12Z"/>',
  'shell-crosshair': '<circle cx="12" cy="12" r="7"/><path d="M12 2.8v4M12 17.2v4M2.8 12h4M17.2 12h4"/>',
  'shell-clock': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.4 2"/>',
  'shell-route': '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
  // wilderness (PLATFORM.md §11): POIs, waystones, travel, your things
  'shell-ruin': '<path d="M3.5 20.5h17M6 20.5V9.2l2.3-1.4v12.7M10.8 20.5v-7.6l2.4 1v6.6M15.8 20.5V7.4l2.4 1.2v11.9"/><path d="M4.6 6.6 8.8 4.8l3 1.6"/>',
  'shell-outpost': '<path d="M7 21 9.6 9h4.8L17 21M8.1 16.2h7.8M8.9 12.4h6.2"/><path d="M12 9V3.2l4.8 1.6L12 6.4"/>',
  'shell-wreck': '<path d="M3 17.6 13.8 9.4l6.6 1-2.2 3.7L6.6 20Z"/><path d="M3 21h18"/><path d="M10.6 7.4 12 4.2M15.2 7 17.4 4.6M18.6 8.6l2.4-1.2" opacity=".75"/>',
  'shell-waystone': '<path d="M9.4 21 10.7 6.4 12 3l1.3 3.4L14.6 21Z"/><path d="M6.8 21h10.4M12 9.4v4.8"/>',
  'shell-waypoint': '<path d="M12 21.2s6.6-6.1 6.6-11a6.6 6.6 0 0 0-13.2 0c0 4.9 6.6 11 6.6 11Z"/><path d="m12 6.8 3 3.3-3 3.3-3-3.3Z"/>',
  'shell-compass-rose': '<circle cx="12" cy="12" r="8.6"/><path d="m12 5.2 2.2 6.8L12 18.8 9.8 12Z"/><path d="M12 5.2 14.2 12H9.8Z" fill="currentColor" stroke="none"/>',
  'shell-gateway': '<ellipse cx="12" cy="11.4" rx="6.2" ry="8.4"/><ellipse cx="12" cy="11.4" rx="2.6" ry="4.8"/><path d="M4 21.2h16"/>',
  'shell-shuffle': '<path d="M3.4 7.2h4.2c4.6 0 4.6 9.6 9.2 9.6h3.8M3.4 16.8h4.2c1.6 0 2.6-1.2 3.4-2.8M14.2 9.6c.8-1.4 1.8-2.4 3.2-2.4h3.2"/><path d="m18.2 4.8 2.4 2.4-2.4 2.4M18.2 14.4l2.4 2.4-2.4 2.4"/>',
  'shell-beacon': '<path d="M12 9.6V3.4M9 21l1.6-9.4h2.8L15 21M7.2 21h9.6"/><path d="M8.4 6.2a5 5 0 0 1 7.2 0M5.8 3.8a8.6 8.6 0 0 1 12.4 0"/>',
  'shell-home': '<path d="M3.6 11.2 12 4.4l8.4 6.8"/><path d="M6.2 9.6v10.6h11.6V9.6"/><path d="M10 20.2v-5.4h4v5.4"/>',
  'shell-skull': '<path d="M12 3.4c-4.4 0-7.6 3-7.6 7.1 0 2.4 1.2 4.2 2.9 5.1v3.4h9.4v-3.4c1.7-.9 2.9-2.7 2.9-5.1 0-4.1-3.2-7.1-7.6-7.1Z"/><circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/><path d="M10.6 19v-2.2M13.4 19v-2.2"/>',
  'shell-boss': '<path d="M3.8 8.2 7.6 11 12 4.2 16.4 11l3.8-2.8-1.6 11.2H5.4Z"/><path d="M8 15.6h8"/><circle cx="12" cy="12.6" r="1" fill="currentColor"/>',
  'shell-hub': '<circle cx="12" cy="12" r="7.2"/><path d="M5.6 19.4 18.4 4.6"/>',
  'shell-question': '<circle cx="12" cy="12" r="8.6"/><path d="M9.5 9.4a2.6 2.6 0 1 1 3.5 2.4c-.7.3-1 .8-1 1.6v.6"/><path d="M12 16.6v.2" stroke-width="2.2"/>',
  'shell-bag': '<path d="M5.6 8.6h12.8l-1.1 12H6.7Z"/><path d="M9 8.6V7a3 3 0 0 1 6 0v1.6"/>',
  'shell-axe': '<path d="M5 20.4 14.6 10.8"/><path d="M12.6 6c2.6-2 5.8-1.8 7.4 0l-3.8 3.8c-1.1-1.6-2.4-2.4-3.6-3.8Z"/>',
  'shell-eye': '<path d="M2.6 12S6 5.6 12 5.6 21.4 12 21.4 12 18 18.4 12 18.4 2.6 12 2.6 12Z"/><circle cx="12" cy="12" r="3"/>',
  'shell-layers': '<path d="m12 4 8.6 4.4L12 12.8 3.4 8.4Z"/><path d="m3.4 12.4 8.6 4.4 8.6-4.4M3.4 16.2l8.6 4.4 8.6-4.4"/>',
  // bed (home respawn), middle mouse button (quick grenade)
  'shell-bed': '<path d="M3.2 18.6V6.4M3.2 14.4h17.6v4.2M20.8 14.4v-2.6a2.6 2.6 0 0 0-2.6-2.6h-7.4v5.2"/><circle cx="7" cy="11.2" r="1.9"/>',
  'shell-mmb': '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M6.6 10.4h10.8"/><rect x="10.6" y="4.8" width="2.8" height="4.4" rx="1.4" fill="currentColor" stroke="none" opacity=".85"/>',
};

export function registerShellIcons() {
  registerIcons(SHELL_ICONS);
}
