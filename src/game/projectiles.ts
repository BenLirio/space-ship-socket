import type { ProjectileState, ShipState } from '../types/game.js';
import { PROJECTILE_LIFETIME_MS, PROJECTILE_SPEED } from './constants.js';
import type { InternalLoopState } from './types.js';

export function spawnProjectile(loop: InternalLoopState, ship: ShipState) {
  // Twin-fire: spawn two projectiles side-by-side, both traveling forward.
  const angle = ship.physics.rotation - Math.PI / 2; // forward vector angle
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);

  // Perpendicular (to left/right) for lateral gun offsets
  const perpX = -dirY;
  const perpY = dirX;

  const muzzleForwardOffset = 30; // distance ahead of ship nose
  const lateralSpacing = 20; // distance between the two barrels

  const baseX = ship.physics.position.x + dirX * muzzleForwardOffset;
  const baseY = ship.physics.position.y + dirY * muzzleForwardOffset;

  const ownerId =
    Object.entries(loop.gameState.ships).find(([, s]) => s === ship)?.[0] || 'unknown';

  // Offsets: +halfSpacing and -halfSpacing along perpendicular
  const half = lateralSpacing / 2;
  const spawnPoints: { x: number; y: number }[] = [
    { x: baseX + perpX * half, y: baseY + perpY * half }, // left (relative)
    { x: baseX - perpX * half, y: baseY - perpY * half }, // right (relative)
  ];

  const now = Date.now();
  for (const p of spawnPoints) {
    const proj: ProjectileState = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ownerId,
      position: { x: p.x, y: p.y },
      velocity: { x: dirX * PROJECTILE_SPEED, y: dirY * PROJECTILE_SPEED },
      rotation: ship.physics.rotation,
      createdAt: now,
    };
    loop.gameState.projectiles.push(proj);
  }
}

export function simulateProjectiles(loop: InternalLoopState, dt: number) {
  const now = Date.now();
  loop.gameState.projectiles = loop.gameState.projectiles.filter((p) => {
    const age = now - p.createdAt;
    if (age > PROJECTILE_LIFETIME_MS) return false;
    p.position.x += p.velocity.x * dt;
    p.position.y += p.velocity.y * dt;
    return true;
  });
}
