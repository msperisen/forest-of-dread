# Forest of Dread

A 2.5D web game in tribute to *Forbidden Forest* (Cosmi, Commodore 64, 1983). A lone archer walks
through an endless haunted forest and fights one kind of creature per level while the day turns
into a stormy night.

Built with **three.js** (WebGL) and **Vite**. Everything is procedural: there are no image or
audio files. The trees, creatures, textures, music and sound effects are all generated at runtime.

**Play it here:** https://msperisen.github.io/forest-of-dread/

## Running

```bash
npm install
npm run dev        # http://localhost:5173
npm run dev:phone  # also reachable from phones on the same Wi-Fi (shows a Network URL)
npm run build      # static build in dist/
npm run preview    # serve the build
```

`dist/` can be hosted on any static web server (asset paths are relative, see `vite.config.js`).
Every push to `main` is built and published to GitHub Pages by `.github/workflows/deploy.yml`.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Walk | ← → or A D | stick / d-pad |
| Aim bow up / down | ↑ ↓ or W S | stick / d-pad |
| Shoot (hold for rapid fire) | Space, J, K or X | A / X / RT |
| Start | Space, Enter or click | A / Start |
| Pause | P or Esc | |
| Mute | M | |

**Phones and tablets** get on-screen controls automatically:

- **Left half:** a floating joystick. Put your thumb down anywhere, drag sideways to walk and up or down to aim.
- **Right:** the FIRE button (hold it for rapid fire).
- **Top right:** pause and mute.

The on-screen controls appear when you touch the screen and fade out after 5 seconds without a
touch. With a gamepad connected to the phone or tablet, they hide as soon as you use it.

Landscape works best. On Android, the game switches to fullscreen when you start.

`?level=N` in the URL starts at level N (1 to 7) for practice.
In the browser console, `game.god = true` makes the archer invulnerable (for testing).

## Levels

1. **The Weavers**: spiders drop from the canopy on threads and pounce (midday)
2. **The Swarm**: giant hornets circle and dive in groups (afternoon)
3. **The Marsh Lords**: toads hop toward you and lash with their tongues (late afternoon)
4. **The Coiled Ones**: serpents slither out of the ground, rear up and strike (dusk)
5. **Wings of Fire**: a wyvern circles, spits fireballs and swoops (night)
6. **The Restless Dead**: skeletons claw their way out of the earth (rainy night)
7. **The Horned Shade**: a towering demon that is only fully visible in lightning flashes (storm)

You get one extra life for every two levels you clear (up to 5 lives; with full lives you get
1000 bonus points instead). After level 7 the forest starts again at midday, and the creatures
get tougher and faster.

## About the music

The soundtrack is an **original composition** in the style of the C64's SID chip. It is not a
transcription of the 1983 score, which is still under copyright. See [docs/DESIGN.md](docs/DESIGN.md).

See [docs/DESIGN.md](docs/DESIGN.md) for the architecture and design notes.
