/** Ø Studio icons (24×24, stroke = currentColor), registered at install. */
import { registerIcons } from '../ui/icons.js';

export function registerStudioIcons() {
  registerIcons({
    'studio-block': '<path d="M12 3.5 20 8v8l-8 4.5L4 16V8Z"/><path d="m4 8 8 4.5L20 8M12 12.5v8"/>',
    'studio-wedge': '<path d="M3.5 19h17V6Z"/><path d="M20.5 6 18 3.8 3.5 17.4" opacity=".55"/>',
    'studio-cylinder': '<ellipse cx="12" cy="6.5" rx="7" ry="2.8"/><path d="M5 6.5v11c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-11"/>',
    'studio-sphere': '<circle cx="12" cy="12" r="8"/><path d="M4 12c0 2 3.6 3.4 8 3.4s8-1.4 8-3.4"/>',
    'studio-cone': '<path d="M12 3.5 5 18c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6Z"/>',
    'studio-spawn': '<ellipse cx="12" cy="16.5" rx="8.5" ry="3.3"/><path d="M12 13V4M8.5 7.5 12 4l3.5 3.5"/>',
    'studio-light': '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>',
    'studio-sign': '<rect x="3.5" y="4.5" width="17" height="10.5" rx="1.5"/><path d="M12 15v5.5M8 20.5h8M7.5 9.8h9"/>',
    'studio-select': '<path d="M5.5 3.5 18 11.6l-5.6 1.5-2.9 6.4Z"/>',
    'studio-move': '<path d="M12 3v18M3 12h18M9.5 5.5 12 3l2.5 2.5M9.5 18.5 12 21l2.5-2.5M5.5 9.5 3 12l2.5 2.5M18.5 9.5 21 12l-2.5 2.5"/>',
    'studio-scale': '<rect x="3.5" y="10.5" width="10" height="10" rx="1.2"/><path d="m13 11 7.5-7.5M14.5 3.5h6v6"/>',
    'studio-undo': '<path d="M8.5 7 4 11.5 8.5 16"/><path d="M4 11.5h10.5a5 5 0 0 1 0 10H12"/>',
    'studio-redo': '<path d="M15.5 7 20 11.5 15.5 16"/><path d="M20 11.5H9.5a5 5 0 0 0 0 10H12"/>',
    'studio-group': '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5" stroke-dasharray="3 2.4"/><rect x="7.5" y="7.5" width="5" height="5" rx="1"/><rect x="11.5" y="11.5" width="5" height="5" rx="1"/>',
    'studio-ungroup': '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.5"/><path d="M14 6.5h3.5V10M10 17.5H6.5V14"/>',
    'studio-dup': '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    'studio-focus': '<circle cx="12" cy="12" r="3"/><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/>',
    'studio-folder': '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>',
    'studio-stairs': '<path d="M3.5 20H8v-4.5h4.5V11H17V6.5h3.5"/>',
    'studio-bridge': '<path d="M2.5 15h19M4.5 15v4M19.5 15v4M3 9.5c3 3.4 15 3.4 18 0M7 12.2V15M12 13v2M17 12.2V15"/>',
    'studio-lamp': '<path d="M12 21V8.5M9 21h6M8 8.5h8l-1.6-4h-4.8Z"/>',
    'studio-gate': '<path d="M5.5 20V6.5h13V20M3 6.5h18M9.5 20v-5.5h5V20"/>',
    'studio-pad': '<ellipse cx="12" cy="18" rx="8" ry="2.6"/><path d="m8 12.5 4-4 4 4M8 8.5l4-4 4 4"/>',
    'studio-tower': '<path d="M8 21V7l4-3.5L16 7v14M6 21h12M10.5 11h3M10.5 15h3"/>',
    'studio-magnet': '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4Z"/><path d="M6 8h4M14 8h4"/>',
    'studio-publish': '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 14.5v3a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-3"/>',
    'studio-exit': '<path d="M10 4.5H5.5v15H10"/><path d="m14 8 4 4-4 4M18 12H9"/>',
    'studio-tree': '<path d="M5 4.5v15M5 8h5M5 16h5"/><rect x="11" y="5.5" width="8" height="5" rx="1.2"/><rect x="11" y="13.5" width="8" height="5" rx="1.2"/>',
    'studio-play': '<path d="M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l10.8-6.8a.8.8 0 0 0 0-1.4L8.7 4.5a.8.8 0 0 0-1.2.7Z"/>',
    'studio-reset': '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
    'studio-flag': '<path d="M5.5 21V4M5.5 4.5h11l-2.5 4 2.5 4h-11"/>',
  });
}
