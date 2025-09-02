import type { ProjectileState, ShipState } from '../types/game.js';
import { PROJECTILE_LIFETIME_MS, PROJECTILE_SPEED } from './constants.js';
import type { InternalLoopState } from './types.js';

export function spawnProjectile(loop: InternalLoopState, ship: ShipState) {
  // Supports variable number of gun origins derived from diff bounding boxes between muzzle on/off sprites.
  const angle = ship.physics.rotation - Math.PI / 2; // forward vector angle (ship nose)
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const ownerId =
    Object.entries(loop.gameState.ships).find(([, s]) => s === ship)?.[0] || 'unknown';

  // Convert local-space bullet origins (relative to resized image center (128x128), +y down) into world space.
  // If none defined, fall back to two default lateral points.
  let origins = ship.bulletOrigins;
  if (!origins || !origins.length) {
    // legacy twin-fire fallback in ship-local space (pixels)
    origins = [
      { x: -10, y: -30 }, // left barrel
      { x: 10, y: -30 }, // right barrel
    ];
  }

  // Rotate local origin into world space. Local +y down; our world +y down too, so rotation is standard.
  // We also add the ship position. Additionally project slightly forward (already encoded in y offset typically).
  const now = Date.now();
  for (const o of origins) {
    const localX = o.x;
    const localY = o.y; // forward is negative Y in sprite (assuming ship pointing up initially)
    // Rotate by ship.rotation around origin (0,0) where initial sprite up corresponds to rotation=0.
    const cosR = Math.cos(ship.physics.rotation);
    const sinR = Math.sin(ship.physics.rotation);
    const worldX = ship.physics.position.x + localX * cosR - localY * sinR;
    const worldY = ship.physics.position.y + localX * sinR + localY * cosR;

    const proj: ProjectileState = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ownerId,
      position: { x: worldX, y: worldY },
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
