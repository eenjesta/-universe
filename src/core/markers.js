/**
 * Waypoint / point-of-interest registry. Producers (quests, landmarks, space)
 * add markers; the HUD (compass, minimap, on-screen diamonds) and the space
 * radar render them.
 *
 *   ctx.markers.set('quest-lookout', {
 *     position: vec3 | () => vec3,
 *     label: 'Uitkijkpost',
 *     kind: 'quest',          // 'quest' | 'poi' | 'npc' | 'vehicle' | 'enemy' | 'friendly' | 'station'
 *     color: '#7fe0ff',
 *     icon: 'quest',          // name from ui/icons.js
 *     scope: 'world',         // 'world' | 'space'
 *     screen: true,           // on-screen marker with distance
 *     compass: true,          // compass strip / minimap
 *   });
 *   ctx.markers.remove('quest-lookout');
 */
export class Markers {
  constructor(events) {
    this.events = events;
    this.map = new Map();
  }

  set(id, def) {
    const m = { id, kind: 'poi', color: '#ece6dc', icon: 'pin', scope: 'world', screen: true, compass: true, ...def };
    this.map.set(id, m);
    this.events?.emit('markers:change', { id, marker: m });
    return m;
  }

  remove(id) {
    if (this.map.delete(id)) this.events?.emit('markers:change', { id, marker: null });
  }

  get(id) {
    return this.map.get(id);
  }

  /** Markers for a scope, with resolved positions. */
  list(scope = 'world') {
    const out = [];
    for (const m of this.map.values()) {
      if (m.scope !== scope) continue;
      const p = typeof m.position === 'function' ? m.position() : m.position;
      if (p) out.push({ ...m, pos: p });
    }
    return out;
  }
}
