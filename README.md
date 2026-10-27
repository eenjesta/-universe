# Ø Universe

Een browsergame in **three.js** naar de conceptposter *Ø Universe — Explore · Create · Connect*:
een open wereld bij gouden uur met een meer, een torenstad en een reuzenplaneet aan de hemel.
Alles is procedureel: geometrie, texturen, shaders en (straks) geluid. Er zijn geen externe assets.

## Starten

```bash
npm install
npm run dev        # http://127.0.0.1:5173  (HOST=0.0.0.0 voor andere apparaten)
npm run build      # productiebuild in dist/
npm run preview    # serveert dist/ op http://127.0.0.1:4173
```

Vereist een recente Node (getest met Node 26) en een browser met WebGL2.

## Besturing

WASD lopen · Shift sprinten · Spatie springen · muis rondkijken (klik om de muis te vangen) ·
E interactie (vasthouden om te scannen) · Enter/T chat · J missies · M kaart · C karakter ·
K marktplaats · H help · Esc pauze.

## Grafische problemen?

Druk op de **`**-toets of open de game met `?gfx` voor het paneel *Grafische diagnose*.
Daarin zet je live bloom, anti-aliasing, schaduwen, omgevingslicht, mist, waterreflectie,
resolutie en afzonderlijke scène-objecten aan of uit. URL-varianten: `?quality=low|medium|high`,
`?bloom=0`, `?msaa=0`, `?shadows=0`, `?post=0`.

## Opbouw

Zie [ARCHITECTURE.md](ARCHITECTURE.md): een kleine core (`src/core`) met event-bus, state,
physics, interacties en UI. Daaromheen zitten modules: wereld (terrein + atmosfeer), landmarks,
characters, systems (missies/dialoog/chat/economie), shell (titel/HUD/kaart/menu's), en straks
vehicles, build, space en audio. Headless tests draaien via `tools/shot.mjs` (Playwright + SwiftShader).
