/**
 * World layout contract — the single source of truth for where things are.
 * Units are metres. +X = east, −Z = north, +Y = up. Water level is y = 0.
 *
 * Heading convention (used everywhere): an object with rotation.y = h faces
 * forward = (−sin h, 0, −cos h). Heading 0 faces north (−Z). Build models so
 * their front points to −Z in local space.
 *
 * The terrain (world/terrain.js) must shape itself around these zones
 * (flat pads at `elevation`, lake basin, city shore). Other modules place
 * content at zone x/z and query the ground height with world.getHeightAt().
 */

export const WORLD = {
  seed: 'o-universe',
  size: 2400, // terrain square side, centred on the origin
  half: 1200,
  playBounds: 1050, // characters/vehicles are kept inside |x|,|z| < playBounds
  waterLevel: 0,
};

/**
 * Zones. `elevation` is the intended ground height of the flat pad (terrain
 * target), `radius` the flattened radius, `heading` the nice default facing.
 */
export const ZONES = {
  spawn: {
    id: 'spawn', label: 'Uitzichtpunt', x: 0, z: 150, elevation: 46, radius: 18, heading: 0,
    desc: 'Een rotsachtige richel met uitzicht over het meer en de stad.',
  },
  lookout: {
    id: 'lookout', label: 'Uitkijkpost', x: -280, z: 30, elevation: 92, radius: 14, heading: 0.6,
    desc: 'Een oude uitkijktoren op de hoogste top van de westelijke heuvels.',
  },
  ruins: {
    id: 'ruins', label: 'Oude ruïnes', x: 250, z: 95, elevation: 28, radius: 32, heading: -0.4,
    desc: 'Overblijfselen van een beschaving die het Ø-symbool al kende.',
  },
  signal: {
    id: 'signal', label: 'Het signaal', x: -120, z: -140, elevation: 4, radius: 18, heading: 0.3,
    desc: 'Een pulserend baken aan de oever van het meer. Aria wacht hier.',
  },
  waterfall: {
    id: 'waterfall', label: 'Waterval', x: -330, z: -205, elevation: 40, radius: 20, heading: 0.9,
    desc: 'Een rivier stort zich hier in het meer.',
    // the lip of the fall; water drops to the lake at `bottom`
    lip: { x: -322, z: -228 }, bottom: { x: -300, z: -262 },
  },
  base: {
    id: 'base', label: 'Jouw basis', x: -230, z: 330, elevation: 22, radius: 62, heading: -1.2,
    desc: 'Een open plek in het bos. Bouw hier je eigen basis.',
    house: { x: -262, z: 342, rotY: -Math.PI / 2 }, // pre-built modern glass house (front faces +X)
    buildArea: { x: -205, z: 318, size: 48 }, // square build plot, grid = 4 m
    landingPad: { x: -186, z: 368 }, // starter landing pad for the VTOL
  },
  plaza: {
    id: 'plaza', label: 'Nexus-plein', x: 360, z: -150, elevation: 5, radius: 78, heading: 0.4,
    desc: 'Het sociale hart van Ø Universe, rond de paarse Levensboom.',
    tree: { x: 360, z: -150, trunkRadius: 4.5, canopyRadius: 22, height: 34 },
    market: { x: 392, z: -118 }, // marketplace terminal (holographic)
    stage: { x: 360, z: -196, rotY: 0 }, // Starfall Festival holo stage, front faces south (+Z) toward the crowd
    bazaar: { x: 424, z: -150, length: 70, rotY: 0 }, // lantern-lit market street (north–south) east of the tree
    oran: { x: 428, z: -132 }, // Oran's stall (old merchant NPC)
  },
  spaceport: {
    id: 'spaceport', label: 'Ruimtehaven', x: 470, z: 250, elevation: 14, radius: 0, heading: -0.9,
    desc: 'Lanceerplatforms, hangars en het kolonieschip.',
    rect: { minX: 380, maxX: 565, minZ: 175, maxZ: 330 },
    hangar: { x: 528, z: 296, w: 150, d: 96, h: 72, rotY: -0.6 }, // giant hangar that houses the colony ship
    pads: {
      ship: { x: 432, z: 222, rotY: -0.9 },
      vtol: { x: 486, z: 205, rotY: -0.9 },
      car: { x: 418, z: 292, rotY: -0.9 },
      colony: { x: 522, z: 292, rotY: -0.6 },
    },
  },
  city: {
    id: 'city', label: 'Aurora-stad', x: 60, z: -820, elevation: 3, radius: 430, heading: 0,
    desc: 'De glinsterende torenstad aan de overkant van het meer.',
  },
};

/**
 * Wider regions (biomes) shaped by the terrain. The jungle and canyon are
 * shaped + planted now; their special content (bioluminescent flora, species
 * scanning, hoverbike race) arrives in a later wave.
 */
export const REGIONS = {
  jungle: {
    id: 'jungle', label: 'Lumen-jungle', x: -640, z: -40, radius: 260, elevation: 62,
    desc: 'Een weelderige, oplichtende jungle op het westelijke plateau, doorsneden door de rivier.',
  },
  canyon: {
    id: 'canyon', label: 'Zonnekloof', x: 780, z: 60, radius: 300, elevation: 60,
    desc: 'Rode zandsteenkloven met bogen en mesa’s — het hoverbike-circuit.',
  },
};

/** Closed race loop through the canyon (x, z); the terrain carves a 24 m wide canyon floor along it. */
export const RACE_TRACK = {
  width: 24,
  floor: 36, // canyon floor elevation along the track
  points: [[600, 40], [650, -120], [800, -205], [950, -125], [990, 60], [930, 235], [780, 300], [640, 215]],
};

/** Lake: an irregular basin between the spawn hills and the city. */
export const LAKE = { x: 0, z: -430, radiusX: 560, radiusZ: 300, depth: 26 };

/** Wooded / rocky islands in the lake (terrain raises them to `height` above the water). */
export const ISLANDS = [
  { x: -60, z: -330, radius: 28, height: 6 },
  { x: 140, z: -385, radius: 40, height: 9 },
  { x: -225, z: -420, radius: 34, height: 12 },
  { x: 60, z: -525, radius: 22, height: 5 },
  { x: 285, z: -480, radius: 45, height: 7 },
  { x: -130, z: -600, radius: 48, height: 8 },
];

/** City land: large flat islands / far shore at ~3 m where the spire city stands (landmarks). */
export const CITY_ISLANDS = [
  { x: 60, z: -810, radius: 185 },
  { x: -225, z: -760, radius: 110 },
  { x: 305, z: -765, radius: 120 },
  { x: 130, z: -1005, radius: 140 },
  { x: -125, z: -955, radius: 95 },
];

/**
 * Rivers (polyline of [x, z, waterHeight]); the terrain carves a channel ~2.5 m
 * below the water height, the atmosphere renders a flowing water ribbon.
 */
export const RIVERS = [
  { id: 'west', width: 16, points: [[-930, 40, 78], [-780, -40, 70], [-640, -110, 62], [-500, -170, 52], [-380, -212, 44], [-322, -228, 40]] },
];

/**
 * Waterfalls: water drops from `lip` (at elevation `top`) to the lake at `bottom`.
 * The terrain makes a cliff here; the atmosphere renders falling water, foam and mist.
 */
export const WATERFALLS = [
  { id: 'main', lip: { x: -322, z: -228 }, bottom: { x: -300, z: -262 }, top: 40, width: 26 },
  { id: 'west-1', lip: { x: -392, z: -300 }, bottom: { x: -370, z: -326 }, top: 34, width: 12 },
  { id: 'west-2', lip: { x: -440, z: -386 }, bottom: { x: -414, z: -404 }, top: 30, width: 16 },
  { id: 'north-west', lip: { x: -478, z: -556 }, bottom: { x: -450, z: -578 }, top: 26, width: 10 },
  { id: 'east', lip: { x: 478, z: -262 }, bottom: { x: 452, z: -286 }, top: 24, width: 14 },
];

/** Floating rock islands hovering above the land (y = altitude of the island's top surface). */
export const FLOATING_ISLANDS = [
  { x: -60, y: 150, z: -255, radius: 22 },
  { x: -235, y: 190, z: -335, radius: 30, fall: true },
  { x: 125, y: 235, z: -430, radius: 18 },
  { x: 300, y: 140, z: 40, radius: 16 },
  { x: 190, y: 178, z: 175, radius: 12 },
  { x: -425, y: 210, z: 60, radius: 26, fall: true },
  { x: -650, y: 185, z: -40, radius: 40, fall: true },
  { x: -560, y: 245, z: 120, radius: 22 },
  { x: -770, y: 205, z: 160, radius: 30, fall: true },
  { x: 245, y: 300, z: -650, radius: 24 },
  { x: -85, y: 330, z: -705, radius: 18 },
];

/**
 * Roads as polylines (x, z). The terrain flattens a corridor of `width` metres
 * along them; the world draws a road surface. Cars are fastest on roads.
 */
export const ROADS = [
  { id: 'east', width: 9, points: [[0, 150], [110, 150], [250, 95], [350, 165], [420, 250]] },
  { id: 'plaza', width: 9, points: [[250, 95], [320, -10], [360, -95]] },
  { id: 'west', width: 8, points: [[0, 150], [-95, 245], [-185, 315]] },
];

/** Fast-travel destinations offered by the title cards / map. */
export const TRAVEL = ['spawn', 'base', 'plaza', 'spaceport', 'lookout', 'ruins', 'signal', 'waterfall'];

export const zone = (id) => ZONES[id];
export const ZONE_LIST = Object.values(ZONES);
