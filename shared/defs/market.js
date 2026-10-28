/**
 * Marketplace prices in Ø-credits (ported from src/systems/economy/items.js) —
 * the server validates C.SPEND {reason: 'market', id, cost: {credits}} with these.
 * `give` = resources added on purchase (consumable packs); other kinds are
 * unlocks (inv.unlocks). SELL_PRICES: credits per resource unit (C.SPEND
 * {reason: 'sell', id: resource, cost: {[resource]: n}}); owned unlocks sell back
 * for 50 % of the price.
 */
export const MARKET = {
  'skin-car-sunset': { id: 'skin-car-sunset', kind: 'skin', price: 750, name: { en: 'Sunset Paint', nl: 'Sunset-lak' } },
  'skin-car-aurora': { id: 'skin-car-aurora', kind: 'skin', price: 900, name: { en: 'Aurora Paint', nl: 'Aurora-lak' } },
  'skin-ship-gold': { id: 'skin-ship-gold', kind: 'skin', price: 1500, name: { en: 'Golden Hull', nl: 'Gouden romp' } },
  'power-fusion': { id: 'power-fusion', kind: 'blueprint', price: 1200, name: { en: 'Fusion Reactor', nl: 'Fusiereactor' } },
  'decor-neon-tree': { id: 'decor-neon-tree', kind: 'blueprint', price: 800, name: { en: 'Neon Tree', nl: 'Neonboom' } },
  'decor-statue': { id: 'decor-statue', kind: 'blueprint', price: 600, name: { en: 'Ø Statue', nl: 'Ø-standbeeld' } },
  'outfit-nomad': { id: 'outfit-nomad', kind: 'outfit', price: 950, name: { en: 'Nomad Poncho', nl: 'Nomade-poncho' } },
  'outfit-vanguard': { id: 'outfit-vanguard', kind: 'outfit', price: 1400, name: { en: 'Vanguard Armor', nl: 'Vanguard-pantser' } },
  'outfit-drifter': { id: 'outfit-drifter', kind: 'outfit', price: 1100, name: { en: 'Drifter Coat', nl: 'Drifter-jas' } },
  'res-metal-100': { id: 'res-metal-100', kind: 'consumable', price: 250, give: { metal: 100 }, name: { en: 'Metal Container', nl: 'Metaalcontainer' } },
  'res-energy-50': { id: 'res-energy-50', kind: 'consumable', price: 200, give: { energy: 50 }, name: { en: 'Energy Cell', nl: 'Energiecel' } },
  'res-wood-100': { id: 'res-wood-100', kind: 'consumable', price: 150, give: { wood: 100 }, name: { en: 'Wood Bundle', nl: 'Houtbundel' } },
  'res-stone-100': { id: 'res-stone-100', kind: 'consumable', price: 120, give: { stone: 100 }, name: { en: 'Stone Blocks', nl: 'Steenblokken' } },
};

/** Ø-credits per unit when selling resources. */
export const SELL_PRICES = { metal: 2, stone: 1, wood: 1.5, energy: 3 };
/** Owned unlocks sell back for this fraction of the price. */
export const SELL_BACK = 0.5;
