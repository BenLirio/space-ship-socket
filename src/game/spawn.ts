import { SPAWN_RANGE } from './constants.js';

export function randomSpawn() {
  const x = (Math.random() * 2 - 1) * SPAWN_RANGE;
  const y = (Math.random() * 2 - 1) * SPAWN_RANGE;
  const rotation = (Math.random() * 2 - 1) * Math.PI; // [-PI, PI]
  return { x, y, rotation };
}
