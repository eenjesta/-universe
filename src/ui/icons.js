/**
 * Line-icon set (24×24 viewBox, stroke = currentColor). Usage:
 *   el.innerHTML = icon('globe', 22)
 * Modules add their own icons with registerIcons() (don't edit this file from
 * a module). Keep the 1.6px stroke, round joins, no fills unless the shape
 * needs it (use fill="currentColor" explicitly).
 */
const ICONS = {
  emblem: '<circle cx="12" cy="12" r="7.2"/><path d="M4.2 19.8 19.8 4.2"/>',
  globe:
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.9 5.2 3.9 8.5s-1.3 6.1-3.9 8.5c-2.6-2.4-3.9-5.2-3.9-8.5S9.4 5.9 12 3.5Z"/><path d="M5.2 7.5h13.6M5.2 16.5h13.6"/>',
  infinity:
    '<path d="M12 12c-1.8-2.4-3.4-3.6-5.1-3.6a3.6 3.6 0 1 0 0 7.2c1.7 0 3.3-1.2 5.1-3.6Zm0 0c1.8 2.4 3.4 3.6 5.1 3.6a3.6 3.6 0 1 0 0-7.2c-1.7 0-3.3 1.2-5.1 3.6Z"/>',
  people:
    '<circle cx="12" cy="8" r="2.8"/><path d="M6.8 19.5v-1.2a5.2 5.2 0 0 1 10.4 0v1.2"/><circle cx="5.6" cy="9.6" r="2"/><path d="M2.6 18.6v-.7a3.3 3.3 0 0 1 4-3.2"/><circle cx="18.4" cy="9.6" r="2"/><path d="M21.4 18.6v-.7a3.3 3.3 0 0 0-4-3.2"/>',
  chip:
    '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/><path d="M9 2.5v3M12 2.5v3M15 2.5v3M9 18.5v3M12 18.5v3M15 18.5v3M2.5 9h3M2.5 12h3M2.5 15h3M18.5 9h3M18.5 12h3M18.5 15h3"/><path d="M12 16v-3.2M12 12.8c-1.8 0-2.8-1-2.8-2.6 1.7 0 2.8 1 2.8 2.6Zm0 0c0-1.9 1-3 2.9-3 0 1.9-1 3-2.9 3Z"/>',
  cube: '<path d="m12 3 7.8 4.5v9L12 21l-7.8-4.5v-9Z"/><path d="M4.2 7.5 12 12l7.8-4.5M12 12v9"/>',
  creative:
    '<path d="m12 3.5 4.3 2.4v4.8L12 13.1l-4.3-2.4V5.9Z"/><path d="M7.7 5.9 12 8.3l4.3-2.4M12 8.3v4.8"/><path d="M3 15.2c1.6-.9 3.4-.6 4.6.3l2.6 2c.6.5.6 1.4 0 1.9-.5.4-1.2.4-1.7 0L7 18.2M21 15.2c-1.6-.9-3.4-.6-4.6.3l-2.6 2c-.6.5-.6 1.4 0 1.9.5.4 1.2.4 1.7 0l1.5-1.2"/>',
  cart: '<path d="M3 4h2.2l2.3 10.6h10.3l2.2-7.6H6.3"/><circle cx="9.2" cy="18.6" r="1.4"/><circle cx="16.4" cy="18.6" r="1.4"/>',
  palette:
    '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.7 1.8-1.6 0-.9-.7-1.3-.7-2.2 0-1 .8-1.7 1.8-1.7h2.2c2.1 0 3.4-1.4 3.4-3.6 0-4.4-3.8-7.9-8.5-7.9Z"/><circle cx="7.8" cy="11.2" r="1.1"/><circle cx="10.4" cy="7.4" r="1.1"/><circle cx="15" cy="7.6" r="1.1"/>',
  swords:
    '<path d="M4 4l9.5 9.5M4 4h3.2l9.3 9.3M4 4v3.2l9.3 9.3"/><path d="M20 4l-9.5 9.5M20 4h-3.2L13 7.8M20 4v3.2l-3.8 3.8"/><path d="m13.6 15.6 2.8-2.8M7.6 12.8l2.8 2.8M15 14.2l4.6 4.6M9 14.2l-4.6 4.6"/>',
  structure: '<path d="m12 3 7.8 4.5v9L12 21l-7.8-4.5v-9Z"/><path d="M4.2 7.5 12 12l7.8-4.5M12 12v9"/>',
  wall: '<path d="M4.5 5.5 12 3l7.5 2.5v13L12 21l-7.5-2.5Z"/><path d="M12 3v18"/><path d="M4.5 5.5 12 8l7.5-2.5" opacity=".55"/>',
  floor: '<path d="M2.8 12.5 12 8l9.2 4.5L12 17Z"/><path d="M2.8 12.5v1.6L12 18.6l9.2-4.5v-1.6"/>',
  roof: '<path d="M2.8 13 12 6l9.2 7"/><path d="M5.5 11v7.5h13V11"/><path d="M12 6v12.5" opacity=".55"/>',
  decor:
    '<path d="M12 21v-7"/><path d="M12 14c-3.6 0-5.6-2-5.6-5.2 3.4 0 5.6 2 5.6 5.2Zm0 0c0-3.6 2.1-6.2 5.6-6.2 0 3.6-2.1 6.2-5.6 6.2Z"/><path d="M8.5 21h7"/><path d="M12 3.2v2.2M9.2 4.4l.8 1.2M14.8 4.4l-.8 1.2"/>',
  power: '<path d="M13 2.8 6.2 13.2h5l-1 8 6.6-10.4h-5Z"/>',
  metal: '<path d="M4 9.5 8 6h8l4 3.5L12 20Z"/><path d="M4 9.5h16M8 6l1.6 3.5L12 20l2.4-10.5L16 6"/>',
  stone: '<path d="M5 17.5 3.5 12 7 6.5l6-1.5 5.5 3.5 2 6-3.5 4Z"/><path d="M7 6.5 9.5 11l4.5 1 4.5-3.5M9.5 11 8 18.5M14 12l3 7"/>',
  wood: '<ellipse cx="7" cy="12" rx="3.5" ry="5.5"/><ellipse cx="7" cy="12" rx="1.4" ry="2.4"/><path d="M7 6.5h10.5c1.9 0 3.5 2.5 3.5 5.5s-1.6 5.5-3.5 5.5H7"/>',
  energy: '<circle cx="12" cy="12" r="8.5"/><path d="M13 6.5 8.8 13h3.6l-.8 4.5L15.8 11h-3.6Z"/>',
  quest: '<circle cx="12" cy="12" r="8.5"/><path d="m12 5.5 2 6.5-2 6.5-2-6.5Z"/><path d="M12 12h.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  'check-circle': '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.4 2.8 2.8L16.2 9.6"/>',
  circle: '<circle cx="12" cy="12" r="8.5"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  'chevron-down': '<path d="m5 9 7 7 7-7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7 4.5v15l12.5-7.5Z"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.2"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.6M12 16.6h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6h.01"/>',
  map: '<path d="m3.5 6.5 5.5-2.5 6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5Z"/><path d="M9 4v13.5M15 6.5V20"/>',
  chat: '<path d="M4 5.5h16v10.5H9.5L5 19.5V16H4Z"/><path d="M8 9.5h8M8 12.5h5"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.5v-1.3a7.2 7.2 0 0 1 14.4 0v1.3"/>',
  car: '<path d="M3 15.5v-2.3c0-.8.5-1.5 1.3-1.7L7 10.8l2.3-3.3c.4-.5 1-.8 1.6-.8h4.3c.7 0 1.3.3 1.7.9l2.1 3.2 1.6.5c.8.3 1.4 1 1.4 1.9v2.3Z"/><circle cx="7.5" cy="16" r="1.9"/><circle cx="16.5" cy="16" r="1.9"/><path d="M7 10.8h12"/>',
  ship: '<path d="M12 3c1.8 2.2 2.7 5 2.7 8.2V16H9.3v-4.8C9.3 8 10.2 5.2 12 3Z"/><path d="M9.3 12.5 5 16.5v2l4.3-1.3M14.7 12.5l4.3 4v2l-4.3-1.3"/><path d="M10.5 16v3.2M13.5 16v3.2"/><circle cx="12" cy="9.5" r="1.2"/>',
  plane: '<path d="M12 9.5v6M9 12.5h6"/><circle cx="12" cy="12.5" r="2.4"/><path d="M3 7.5 9.8 11M21 7.5 14.2 11M3 7.5l-.5-2M21 7.5l.5-2M8.5 17.5 6 20M15.5 17.5 18 20"/>',
  colony: '<path d="M2.5 14.5 6 10h12l3.5 4.5-3 2.5h-13Z"/><path d="M8 10V7.5h8V10M6 17v2.5M18 17v2.5M9.5 13h5"/>',
  rocket: '<path d="M12 2.8c3 2.3 4.4 5.6 4.1 9.8L12 16.7l-4.1-4.1C7.6 8.4 9 5.1 12 2.8Z"/><circle cx="12" cy="9.4" r="1.6"/><path d="M7.9 12.6 5 14.3l1.6 3 3.3-.6M16.1 12.6l2.9 1.7-1.6 3-3.3-.6M10.5 18.3 12 21.2l1.5-2.9"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8Z"/>',
  signal: '<circle cx="12" cy="12" r="1.6"/><path d="M8.3 15.7a5.2 5.2 0 0 1 0-7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4M5.5 18.5a9.2 9.2 0 0 1 0-13M18.5 5.5a9.2 9.2 0 0 1 0 13"/>',
  scan: '<path d="M4 8V5.5C4 4.7 4.7 4 5.5 4H8M16 4h2.5c.8 0 1.5.7 1.5 1.5V8M20 16v2.5c0 .8-.7 1.5-1.5 1.5H16M8 20H5.5C4.7 20 4 19.3 4 18.5V16"/><path d="M4 12h16"/>',
  laser: '<path d="M3 15.5 13 10M13 10l8-4.5"/><circle cx="13" cy="10" r="2.2"/><path d="M5.5 19.5 3.5 18M9 6 8 3.8M17 14l2.3.8"/>',
  shield: '<path d="M12 3 19 5.8v5.4c0 4.5-3 8.2-7 9.8-4-1.6-7-5.3-7-9.8V5.8Z"/>',
  boost: '<path d="m4 7 5 5-5 5M11 7l5 5-5 5"/><path d="M18 7v10"/>',
  radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 18 6"/><circle cx="15.2" cy="14.6" r=".9" fill="currentColor"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5.6"/><path d="M9.5 14.8 14.5 9.2"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18v-2.5H3ZM12 6.5V20"/><path d="M12 6.5c-2.6 0-4.2-.9-4.2-2.2 0-1.8 2.6-1.5 4.2 2.2Zm0 0c2.6 0 4.2-.9 4.2-2.2 0-1.8-2.6-1.5-4.2 2.2Z"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5v10h12v-10M10 19.5v-5h4v5"/>',
  tree: '<path d="M12 21v-5"/><path d="M12 3.5 6.5 11h3L6 16h12l-3.5-5h3Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>',
  hand: '<path d="M8 13.5V6.8a1.4 1.4 0 0 1 2.8 0v5M10.8 11.5V5.2a1.4 1.4 0 0 1 2.8 0v6.3M13.6 11.5V6.5a1.4 1.4 0 0 1 2.8 0v6.5M16.4 13V9.6a1.4 1.4 0 0 1 2.8 0v4.9c0 3.6-2.6 6.5-6.2 6.5h-1c-2.1 0-3.5-.8-4.7-2.4L4.8 14.5a1.4 1.4 0 0 1 2.1-1.8L8 13.5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01M6 12.5h.01M18 12.5h.01M8.5 15h7"/>',
  mouse: '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 7v3"/>',
  camera: '<path d="M4 8h3l1.6-2.5h6.8L17 8h3v11H4Z"/><circle cx="12" cy="13.3" r="3.4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 10.5v6M14 10.5v6"/>',
  rotate: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  arrow: '<path d="M12 3.5 18 19l-6-3.5L6 19Z"/>',
  dock: '<path d="M12 3v9M8.5 8.5 12 12l3.5-3.5"/><path d="M4 14.5h16v5H4Z"/><path d="M8 17h.01M12 17h.01M16 17h.01"/>',
  warp: '<path d="M3 12h4M17 12h4M5 7l3 2M19 7l-3 2M5 17l3-2M19 17l-3-2"/><circle cx="12" cy="12" r="3"/>',
  target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  party: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19.5v-1a5.5 5.5 0 0 1 11 0v1"/><path d="M16.5 8.5h5M19 6v5"/>',
  book: '<path d="M4 5.5c2.7-1 5.3-1 8 .8 2.7-1.8 5.3-1.8 8-.8v13c-2.7-1-5.3-1-8 .8-2.7-1.8-5.3-1.8-8-.8Z"/><path d="M12 6.3v13"/>',
  sparkle: '<path d="M12 3.5c.6 4.3 2.2 5.9 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.6 5.9-2.2 6.5-6.5Z"/><path d="M18.5 15.5c.3 1.9 1 2.6 2.9 2.9-1.9.3-2.6 1-2.9 2.9-.3-1.9-1-2.6-2.9-2.9 1.9-.3 2.6-1 2.9-2.9Z"/>',
  wind: '<path d="M3 9h10.5a2.5 2.5 0 1 0-2.5-2.5M3 13h15.5a2.5 2.5 0 1 1-2.5 2.5M3 17h7"/>',
  fps: '<path d="M4 17.5a8 8 0 1 1 16 0"/><path d="m12 17.5 4-5"/>',
};

export function icon(name, size = 20, extraClass = '') {
  const body = ICONS[name] || ICONS.circle;
  return `<svg class="icon ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/**
 * Lets modules add icons at install time without editing this file:
 *   registerIcons({ 'my-icon': '<path d="…"/>' })
 * (24×24 viewBox, stroke = currentColor, same style as above).
 */
export function registerIcons(map) {
  for (const [name, body] of Object.entries(map)) ICONS[name] = body;
}

export function hasIcon(name) {
  return name in ICONS;
}

export const ICON_NAMES = Object.keys(ICONS);
