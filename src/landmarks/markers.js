/**
 * Landmarks — points of interest on ctx.markers (kind 'poi', Dutch labels)
 * plus a few line icons registered on the shared icon set. Only the city
 * gets an on-screen marker (like "Aurora-stad 1,2 km"); the rest show on the
 * compass strip / minimap / map.
 */
import * as THREE from 'three';
import { ZONES } from '../world/layout.js';
import { registerIcons, hasIcon } from '../ui/icons.js';

const ICONS = {
  'lm-lookout': '<path d="M8 21 10 8h4l2 13"/><path d="M7 8h10l-1.6-3.5H8.6Z"/><path d="M9.3 13h5.4M8.6 17.5h6.8M10 8l4 5M14 8l-4 5"/>',
  'lm-ruins': '<path d="M3.5 20.5h17"/><path d="M5.5 20.5V8.5M9.5 20.5V8.5M4.5 8.5h6"/><path d="M14.5 20.5v-7l1-1 1 1.4v6.6"/><path d="M18.5 20.5v-9.5l-.8-.8"/>',
  'lm-waterfall': '<path d="M3 7h8.5c2.5 0 4 1.3 4 3.5"/><path d="M8.5 7v9.5M11.5 7.2v10.3M15.5 10.5v7"/><path d="M4 20c2-1.4 4-1.4 6 0s4 1.4 6 0 3-1.1 4.5-.6"/>',
  'lm-city': '<path d="M3 21h18"/><path d="M6 21V12l2-2 2 2v9"/><path d="M10 21V7l2-3.5L14 7v14"/><path d="M14 21v-7h4v7"/><path d="M12 3.5V1.8"/>',
  'lm-spawn': '<path d="M3 20 9.5 9l3.4 5.8 2.1-3.3L21 20Z"/><path d="M9.5 9V3.5l4 1.5-4 1.5"/>',
  'lm-plaza': '<path d="M12 21v-6"/><path d="M12 15c-4.4 0-7-2.4-7-5.6S8 3.5 12 3.5s7 2.7 7 5.9S16.4 15 12 15Z"/><path d="M8 21h8"/>',
};

export function installMarkers(ctx, api, ground) {
  if (!ctx.markers?.set) return [];
  try {
    registerIcons(ICONS);
  } catch (err) {
    console.warn('[landmarks] could not register icons', err);
  }
  const icon = (name, fallback) => (hasIcon?.(name) ? name : fallback);
  const lift = (x, z, h = 2) => new THREE.Vector3(x, ground.at(x, z) + h, z);
  const Z = ZONES;
  const defs = [
    { id: 'spawn', label: Z.spawn.label, icon: icon('lm-spawn', 'pin'), pos: lift(Z.spawn.x, Z.spawn.z) },
    { id: 'lookout', label: Z.lookout.label, icon: icon('lm-lookout', 'pin'), pos: api.lookout?.top?.clone().add(new THREE.Vector3(0, 3, 0)) || lift(Z.lookout.x, Z.lookout.z, 24) },
    { id: 'ruins', label: Z.ruins.label, icon: icon('lm-ruins', 'pin'), pos: api.ruins?.relief?.clone() || lift(Z.ruins.x, Z.ruins.z, 6) },
    { id: 'signal', label: Z.signal.label, icon: 'signal', color: '#7fe0ff', pos: api.beacon?.top?.clone() || lift(Z.signal.x, Z.signal.z, 20) },
    { id: 'waterfall', label: Z.waterfall.label, icon: icon('lm-waterfall', 'pin'), pos: lift(Z.waterfall.lip?.x ?? Z.waterfall.x, Z.waterfall.lip?.z ?? Z.waterfall.z, 3) },
    { id: 'base', label: Z.base.label, icon: 'home', pos: api.house?.position?.clone().add(new THREE.Vector3(0, 6, 0)) || lift(Z.base.x, Z.base.z, 4) },
    { id: 'plaza', label: Z.plaza.label, icon: icon('lm-plaza', 'tree'), color: '#b48cff', pos: lift(Z.plaza.x, Z.plaza.z, 36) },
    { id: 'spaceport', label: Z.spaceport.label, icon: 'rocket', pos: lift(Z.spaceport.x, Z.spaceport.z, 10) },
    { id: 'city', label: Z.city.label, icon: icon('lm-city', 'pin'), pos: api.city?.top?.clone() || lift(Z.city.x, Z.city.z, 300), screen: true },
  ];
  const ids = [];
  for (const d of defs) {
    const id = `poi-${d.id}`;
    ctx.markers.set(id, {
      position: d.pos,
      label: d.label,
      kind: 'poi',
      zone: d.id,
      color: d.color || '#ece6dc',
      icon: d.icon,
      scope: 'world',
      screen: !!d.screen,
      compass: true,
    });
    ids.push(id);
  }
  return ids;
}
