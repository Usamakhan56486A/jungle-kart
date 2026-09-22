# Jungle Kart — Wild Circuit

An original animal kart racing game for up to six friends. Play split-screen on one PC, over the local network from any browser (phones, tablets, laptops), or against AI in a three-race Grand Prix. Everything runs locally in Node.js — no accounts, no cloud, no ads.

## Quick start

Double-click `START-GAME.cmd` on Windows, or from a terminal:

```bash
npm install --omit=dev
npm start
```

Then open the printed URL (default <http://localhost:4173>). On first launch the server also prints the router/LAN address — share that with friends on the same Wi-Fi so they can join from their phones.

## How to play

- **Solo practice** — you plus three AI drivers on any of the eight circuits.
- **Same PC** — click "Add local player" to add keyboard-2 or any connected gamepad. Up to six views split the screen automatically.
- **LAN / phones** — each friend opens the router address on their device. They can race with their own screen, or pick "Controller only" to use the phone as a wireless pad while the PC renders the split-screen.
- **Grand Prix** — three-race cup across the track rotation with 10/8/6/4/2/1 points.

### Controls

| Input | Accelerate | Brake / Drift | Use item |
| --- | --- | --- | --- |
| Keyboard 1 | W | S / Shift | Space or E |
| Keyboard 2 | ↑ | ↓ / Right Shift | Enter |
| Gamepad | Right trigger | Left trigger / X | A or B |
| Touch | Auto-throttle | Brake / Drift buttons | Item button |

## Features

- **Eight 3D circuits** — Canopy Cruise, Temple Tangle, Sunset Splash, Mangrove Sprint, Volcano Ridge, Coral Canyon, Moonlit Marsh and Skyvine Spiral. Each has its own surface, sky, fog, foliage and landmark set (waterfalls, ember vents, bioluminescent lanterns, floating sky platforms).
- **Fifteen animal drivers** with hand-built geometry, per-species patterns, wet eyes, tails and scarves.
- **Six vehicle bodies** — Trail Kart, Safari Jeep, Dune Buggy, Rally Coupe, Hover Racer, Jungle Tuk-Tuk. All share identical acceleration, top speed and handling; only the silhouette changes. Painted panels use a gloss paint-flake material; exhaust tips, hub caps, bumper trim and light rings use a brushed-chrome material.
- **Twelve powers** — Mango Boost, Homing Coconut, Vine Shield, Mud Pod, Thunder Drum, Slip Banana, Sky Rocket, Reef Shell, Sun Star, Storm Call, Vine Magnet and Spirit Swap. Each has its own funny synthesized sound on use and on hit.
- **Glowing diamond power boxes** — faceted octahedron crystals that cycle through a rainbow palette and pulse over time.
- **Drift charging** — hold drift through a corner to build charge, release for a boost.
- **Local leaderboard** — human finishes are saved to `data/leaderboard.json` and survive restarts.
- **Split-screen** — 1, 2, 4 or 6 viewports covering the canvas without overlap.
- **Phone-as-controller** — a phone on the LAN can drive a racer rendered on the host PC.

## Project layout

```
server.mjs        HTTP + WebSocket host, LAN URL discovery, leaderboard API
game.mjs          Authoritative 60 Hz simulation: physics, items, AI, cups
leaderboard.mjs   Persisted human standings
public/world.js   Track/item/animal/vehicle data shared by server and client
public/scene.js   Three.js renderer, procedural textures, split-screen cameras
public/app.js     Lobby UI, HUD, input, Web Audio sound synthesis
public/index.html Markup, SVG sprite, help dialog
public/style.css  Layout and theme
test/             Node test suite (30 tests) and optional Playwright browser check
docs/             Screenshots and the original conversation export
```

## Tests

```bash
npm test                 # 30 unit tests: physics, items, tracks, LAN, leaderboard
npm run test:browser     # optional headless Playwright smoke test
```

## Requirements

- Node.js 18 or newer
- A WebGL2-capable browser (Chrome, Edge, Firefox, Safari 16+)
- For LAN play, all devices on the same router/Wi-Fi

## Credits

Everything in this repository — code, geometry, textures, sound synthesis, animal and vehicle designs — is original work generated for this project. Three.js (MIT) and ws (MIT) are the only runtime dependencies.
