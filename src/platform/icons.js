/** Line icons for the platform UI (24×24, stroke = currentColor, same style as src/ui/icons.js). */
import { registerIcons } from '../ui/icons.js';

export function registerPlatformIcons() {
  registerIcons({
    'plat-search': '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
    'plat-heart': '<path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10Z"/>',
    'plat-heart-fill': '<path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10Z" fill="currentColor"/>',
    'plat-flag': '<path d="M5.5 21V4.5"/><path d="M5.5 5c4-2 6.5 1.6 13 0v8.5c-6.5 1.6-9-2-13 0"/>',
    'plat-logout': '<path d="M10 4.5H5.5v15H10"/><path d="m15 8 4 4-4 4M19 12H9.5"/>',
    'plat-login': '<path d="M14 4.5h4.5v15H14"/><path d="m9 8 4 4-4 4M13 12H3.5"/>',
    'plat-offline': '<path d="M3.5 9.2a12.5 12.5 0 0 1 4-2.4M20.5 9.2A12.5 12.5 0 0 0 11 6.1"/><path d="M6.5 12.6a8 8 0 0 1 3-1.8M17.5 12.6a8 8 0 0 0-2.4-1.6"/><circle cx="12" cy="17.5" r="1.2" fill="currentColor"/><path d="m4 4 16 16"/>',
    'plat-edit': '<path d="M14.5 5.5 18.5 9.5 9 19H5v-4Z"/><path d="m12.5 7.5 4 4"/>',
    'plat-dots': '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
    'plat-user-plus': '<circle cx="9.5" cy="8.5" r="3.6"/><path d="M3 20v-.8a6.5 6.5 0 0 1 13 0v.8"/><path d="M19 8v6M16 11h6"/>',
    'plat-eye': '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    'plat-eye-off': '<path d="M4 4l16 16"/><path d="M9.9 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.6 7.3A16.4 16.4 0 0 0 2.5 12S6 18.5 12 18.5c1.7 0 3.2-.5 4.5-1.2"/><path d="M10 10a3 3 0 0 0 4 4"/>',
    'plat-refresh': '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
    'plat-lock': '<rect x="5.5" y="10.5" width="13" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    'plat-compass': '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>',
    'plat-studio': '<path d="M12 3.5 19.5 7.8v8.4L12 20.5l-7.5-4.3V7.8Z"/><path d="M4.5 7.8 12 12l7.5-4.2M12 12v8.5"/><path d="M15.8 3.2l1.4 1.4M19.6 1.8v2" opacity=".6"/>',
    'plat-cloud': '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.8a4.4 4.4 0 0 1-.5 8.7Z"/><path d="m9.5 13.5 2.5 2.5 3.5-4"/>',
    'plat-check': '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    'plat-x': '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
    'plat-expand': '<path d="M4.5 9V4.5H9M19.5 9V4.5H15M4.5 15v4.5H9M19.5 15v4.5H15"/>',
  });
}
