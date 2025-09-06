import type { ProjectileState, ShipState } from '../types/game.js';
import {
  PROJECTILE_LIFETIME_MS,
  PROJECTILE_SPEED,
  SHIP_HIT_RADIUS,
  BULLET_DAMAGE,
} from './constants.js';
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
  const survivors: ProjectileState[] = [];

  for (const p of loop.gameState.projectiles) {
    const age = now - p.createdAt;
    if (age > PROJECTILE_LIFETIME_MS) continue; // despawn

    const startX = p.position.x;
    const startY = p.position.y;
    const endX = startX + p.velocity.x * dt;
    const endY = startY + p.velocity.y * dt;

    let hit = false;
    for (const [shipId, ship] of Object.entries(loop.gameState.ships)) {
      if (shipId === p.ownerId) continue; // no friendly fire to owner
      if ((ship.health ?? 0) <= 0) continue; // ignore destroyed ships

      const cx = ship.physics.position.x;
      const cy = ship.physics.position.y;

      // Quick reject using AABB expanded by radius
      const minX = Math.min(startX, endX) - SHIP_HIT_RADIUS;
      const maxX = Math.max(startX, endX) + SHIP_HIT_RADIUS;
      const minY = Math.min(startY, endY) - SHIP_HIT_RADIUS;
      const maxY = Math.max(startY, endY) + SHIP_HIT_RADIUS;
      if (cx < minX || cx > maxX || cy < minY || cy > maxY) {
        // cannot intersect
      } else {
        // Segment-circle intersection test
        const dx = endX - startX;
        const dy = endY - startY;
        const fx = startX - cx;
        const fy = startY - cy;
        const a = dx * dx + dy * dy;
        const b = 2 * (fx * dx + fy * dy);
        const c = fx * fx + fy * fy - SHIP_HIT_RADIUS * SHIP_HIT_RADIUS;

        let intersects = false;
        if (a > 1e-12) {
          const disc = b * b - 4 * a * c;
          if (disc >= 0) {
            const sqrtDisc = Math.sqrt(disc);
            const t1 = (-b - sqrtDisc) / (2 * a);
            const t2 = (-b + sqrtDisc) / (2 * a);
            if ((t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1)) {
              intersects = true;
            }
          }
        } else if (c <= 0) {
          // Bullet not moving this frame and already inside radius
          intersects = true;
        }

        if (intersects) {
          ship.health = Math.max(0, (ship.health ?? 100) - BULLET_DAMAGE);
          hit = true;
          break; // bullet consumed
        }
      }
    }

    if (!hit) {
      p.position.x = endX;
      p.position.y = endY;
      survivors.push(p);
    }
  }

  loop.gameState.projectiles = survivors;
}
