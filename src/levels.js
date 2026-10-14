// One creature type per level, like the original. Time of day (tod) runs
// 0 = midday ... 0.55 = dusk ... 0.75 = night ... 1 = storm night.
// kills: creatures to defeat, maxAlive: on screen at once, group: spawned together.
export const LEVELS = [
  { name: 'The Weavers', sub: 'Giant spiders lurk in the canopy', type: 'spider', kills: 6, maxAlive: 2, interval: 3.0, tod: 0.0, storm: 0, rain: 0, intensity: 1 },
  { name: 'The Swarm', sub: 'Something buzzes between the trees', type: 'wasp', kills: 12, maxAlive: 6, group: 4, interval: 5, tod: 0.2, storm: 0, rain: 0, intensity: 1 },
  { name: 'The Marsh Lords', sub: 'Giant toads hunt along the path', type: 'toad', kills: 5, maxAlive: 2, interval: 3.5, tod: 0.38, storm: 0, rain: 0, intensity: 1 },
  { name: 'The Coiled Ones', sub: 'Serpents beneath the moss', type: 'serpent', kills: 4, maxAlive: 1, interval: 2.5, tod: 0.55, storm: 0, rain: 0, intensity: 1 },
  { name: 'Wings of Fire', sub: 'A wyvern circles above the treetops', type: 'wyvern', kills: 2, maxAlive: 1, interval: 3, tod: 0.7, storm: 0.3, rain: 0, intensity: 2 },
  { name: 'The Restless Dead', sub: 'The dead claw their way out of the earth', type: 'ghoul', kills: 8, maxAlive: 3, interval: 2.5, tod: 0.82, storm: 1, rain: 1, intensity: 2 },
  { name: 'The Horned Shade', sub: 'Only the lightning shows its shape', type: 'shade', kills: 1, maxAlive: 1, interval: 3, tod: 1.0, storm: 2.2, rain: 1, intensity: 2 },
];
