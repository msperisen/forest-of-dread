# Design notes

## Goal

Capture what made the 1983 C64 game memorable, with modern rendering on top:

- a side view of one archer in a dark, deep, parallax forest
- one creature type per level, with escalating danger
- a day-to-night cycle ending in a lightning storm and a final demon
- ominous synth music and plenty of gore (blood particles that stay on the ground)

Everything here is an original implementation. The game copies no code, graphics or music
from the original, only the general concept and the feel.

## 2.5D approach

The game is played on a 2D plane at `z = 0`: the archer, creatures and arrows all live on it,
and every collision is tested there. Everything else is real 3D geometry at other depths, seen
through a perspective camera (`CAM_Z = 12.5`, 38° FOV). That gives:

- **true parallax** without hand-tuned scroll speeds: foreground trunks (z ≈ +5) sweep past,
  and distant trees (z down to -65) drift slowly and disappear into the fog
- **atmospheric depth** from `FogExp2`, whose colour and density follow the time of day
- **dynamic lighting**: hemisphere light plus a sun/moon directional light with soft shadows,
  a cool rim light that outlines the figures, point lights on fireballs, and lightning flashes
- **bloom** (UnrealBloomPass) on HDR materials: creature eyes, glowing mushrooms, fireflies,
  fire, lightning bolts and magic
- CSS vignette and scanlines as a light retro touch

### Infinite forest

The forest is a fixed set of objects that get recycled. Each object has a range based on its
depth, `(CAM_Z - z) * 0.95 + 6`. When it scrolls further than that from the camera, it jumps by
twice the range to the other side. Grass and mushrooms are `InstancedMesh`es that do the same per
instance. The ground and path textures scroll in whole tile steps, so they look fixed in the world.

Foreground trunks fade to 18% opacity while they are in front of the archer on screen.

### Procedural assets

- **Trees** (`world.js`): 8 templates (gnarled dead trees, oaks, pines), built from bent and
  knotted cylinders with recursive branches and lumpy icosahedron canopies, then merged into one
  geometry per template. Bark, ground, path and mist are canvas textures.
- **Creatures** (`monsters.js`): built from primitives and animated procedurally
  (spider leg gait, wing flapping, serpent body following a trail, skeleton walk cycle, and so on).
- **Archer** (`archer.js`): a hooded ranger with a jointed walk cycle, a visible bow draw (the
  string pulls back and the arrow is nocked) and a death fall.

## Code map

| File | Purpose |
|---|---|
| `src/main.js` | `Game`: renderer, post-processing, state machine (title → intro → play → dying/clear → over), spawning, camera, HUD |
| `src/world.js` | forest scenery, sky, sun and moon, palette for the time of day, mist, rain, lightning, fireflies |
| `src/archer.js` | player character |
| `src/arrows.js` | arrow mesh and physics; arrows stick in the ground or in creatures |
| `src/monsters.js` | `Monster` base class plus Spider, Wasp, Toad, Serpent, Wyvern, Ghoul, Shade |
| `src/effects.js` | pooled GPU point particles (normal and additive): blood, dirt, sparks, fire, smoke, magic |
| `src/audio.js` | WebAudio synth in SID style, step sequencer, jingles, sound effects, ambience |
| `src/music.js` | song data: chords, bass pattern, lead melodies, jingles |
| `src/levels.js` | level table |
| `src/input.js` | keyboard, gamepad and touch state |
| `src/touch.js` | on-screen controls for touch devices (floating joystick, fire, pause, mute), fullscreen and landscape lock |

### Monster contract

Each creature extends `Monster` and implements `update(dt)` and, optionally, `dieAnim(dt)`.
Hit areas are spheres attached to body parts (`addHit(part, radius)`), so they follow the
animation automatically. `testPoint(p)` handles arrow hits and `touchesPlayer()` handles contact
kills. Adding a creature means writing one class, adding it to `createMonster` and adding a
level entry.

## Touch controls

`touch.js` runs only when the device reports a coarse pointer or touch points. It writes into
`input.touch` (`x`, `y` in -1..1 and `fire`), and the `Input` getters read that the same way as
a gamepad: |x| > 0.35 walks and |y| > 0.45 aims, so a diagonal walks and aims at once. Each
control tracks its own pointer id, so you can walk and shoot at the same time. A tap on FIRE
counts even if it's shorter than a frame, and it's buffered for 0.3 s while the bow is still
drawing. The controls are shown on any touch and fade out after 5 s without one (never while a
finger is on the stick or FIRE). `Input.poll` records when a gamepad was last used
(`gpUsedAt`), and the controls hide as soon as that is newer than the last touch. Faded
controls keep receiving input, so the first touch already acts. On touch devices the render resolution is lower and the shadow map is smaller, to keep
the frame rate up.

## Audio

`audio.js` imitates the C64 SID chip using WebAudio:

- band-limited **pulse waves** at 12.5%, 25% and 50% duty (`PeriodicWave`), plus saw, triangle
  and noise
- an ADSR envelope per note, a **resonant low-pass filter** with an envelope sweep (the
  "plucky" SID bass), delayed **vibrato**, pitch slides
- **chord arpeggios** at 50 Hz on a single voice, the classic C64 trick for playing chords on
  three voices
- a dotted-eighth echo, and a global low-pass that closes down as night falls
- a look-ahead scheduler (25 ms tick, 150 ms horizon) for timing that stays exact

The **music is original**, written for this project: D minor with a harmonic-minor A major for
tension, in sections intro / A / B / C. The 1983 *Forbidden Forest* score is copyrighted and
is not reproduced here. To change the music, edit `src/music.js`. Lead lines are written as
eighth-note tokens, `'D5 - - - A4 - - -'`, where `-` holds the note and `.` is a rest.

## Possible next steps

- a dedicated `.sid` player, so players can load a SID tune they own themselves
- more creature variety per level, and a final boss attack pattern with projectiles
- difficulty options and an online high-score table
