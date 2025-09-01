import type { ProjectileState, ShipState } from '../types/game.js';
import { PROJECTILE_LIFETIME_MS, PROJECTILE_SPEED } from './constants.js';
import type { InternalLoopState } from './types.js';

export function spawnProjectile(loop: InternalLoopState, ship: ShipState) {
  const angle = ship.physics.rotation - Math.PI / 2; // forward
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const muzzleOffset = 30; // spawn a bit ahead of ship nose
  const posX = ship.physics.position.x + dirX * muzzleOffset;
  const posY = ship.physics.position.y + dirY * muzzleOffset;
  const proj: ProjectileState = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ownerId: Object.entries(loop.gameState.ships).find(([, s]) => s === ship)?.[0] || 'unknown',
    position: { x: posX, y: posY },
    velocity: { x: dirX * PROJECTILE_SPEED, y: dirY * PROJECTILE_SPEED },
    rotation: ship.physics.rotation,
    createdAt: Date.now(),
  };
  loop.gameState.projectiles.push(proj);
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
