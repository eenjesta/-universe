# Vehicles — progress log

## Status (newest first)
- [x] geo.js / materials.js helpers (PartBuilder merge, loft, panel/window/skin shader patch)
- [x] colony-model.js createColonyShipModel(opts) — done early (space can import it)
- [x] car-model.js, vtol-model.js, ship-model.js (uses src/space/ship-model.js via import.meta.glob, local fallback), studio.js, dev/lab.html
- [x] fleet.js (parking at pads / base pad / hangar, physics boxes, F interactions, summon + hover-down)
- [x] controllers.js (car arcade physics, VTOL/ship hover flight), drive.js (mode 'drive'), hud.js, fx.js
- [x] garage.js (G, ?garage) — verified run 2 (final_garage.png, r2_garage_nl.png, Summon click)
- [x] traffic.js (16 agents, 4 draw calls, hangar-roof landing shuttle) — verified run 2 (r2_traffic.png, logic: all move)
- [x] verify (run 2, logic1 batch): F board car → drive, W 4 s → 24.8 m/s, F exit → explore 2.3 m beside car; F at spawn → 'No vehicle nearby' toast; ship L → autoLaunch → vehicle:launch → space (real module); explore {arrival:'ship'} → ship on pad, player 5.4 m away; errors []
- [x] polish (run 2): car wedge nose + thin splitter, tapered/lowered tail, quad exhausts, louvres, gunmetal default paint
      (iteration 2/2 — car DONE); VTOL rear turbine pods + light bars + ventral fins (1/2); colony plating calmer +
      shader fades per-panel tint by pixel size (1/2); garage: 16:10 thumbs, location line per card, short fast-travel
- [x] verified (run 2): garage 4 columns @1280 (EN + NL), G opens it, Summon VTOL → hovers down 43 m → parked 12 m away
      (vehicle:summon + vehicle:arrived), Dutch HUD/hints, car on east road 126 km/h ROAD tag
- [x] final high-quality shots (1280x720, high): final_spaceport.png (frozen establishing camera: VTOL pad 02, ship
      pad 01, colony ship flank in the hangar), final_garage.png (?garage hook, 4 thumbnails), final_base.png
      (time=16.4), final_vtol_lake.png (154 km/h, 9 m). Medium: r2_car_road.png (126 km/h, ROAD), r2_traffic.png,
      r2_drive_nl.png (NL HUD + traffic over the city), r2_garage_nl.png. Ship climb: g2_ship.png (run 1).
- [x] final logic (low): car blocked by deep water (stops at 0.43 m depth), car vs hangar back wall (impact 8.7,
      slides along, stays inside), VTOL C-descent from 12 m → landed + vehicle:land → F exit, 16 traffic agents
      move, landing shuttle cruise→descend; build passes; errors [] everywhere.
- STATUS: DONE (brief's "Done when" met). Not built: hoverbike (optional extra / later wave).

## Resume 17:02 (run 2)
- Found: all files present, build passes, i18n t({en,nl}) already used everywhere; space module DONE (real space mode).
- Shots from run 1 up to 14:58 exist (h1–h4, g6_garage, g6_traffic) — look at them before re-shooting.
- Next: logic batch (F exit, no-vehicle toast, launch→space, arrival), then visual review + polish.

## Verified
- in-game (quality=low): module installs, errors [] ; ship source = space
- car: 123 km/h off-road after 5 s, boost + handbrake drift work; VTOL climbs/flies 166 km/h over the lake;
  ship climbs + 400 km/h; HUD shows speed/altitude/boost; key hints bottom-right.

## Test recipes
- scratchpad is SHARED with other engineers → name batch files veh-*.json; one high-quality session ≤ ~3 shots (590 s limit)
- lab: /src/vehicles/dev/lab.html?model=car|vtol|ship|colony&view=three-quarter|side|rear
- shot.mjs eval must contain a top-level `return` (else it is wrapped as an expression)
- __game.vehicles.controller() → active controller state (speed, altitude, landed, road…)
