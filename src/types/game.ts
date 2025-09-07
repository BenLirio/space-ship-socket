export type EntityId = string;

export interface Vector2 {
  x: number;
  y: number;
}

// Sprite variants keyed by state name (matches generator response "sprites")
export interface ShipSprites {
  // Canonical sprite variant keys (v2.0.0+)
  thrustersOnMuzzleOn: { url: string };
  thrustersOffMuzzleOn: { url: string };
  thrustersOnMuzzleOff: { url: string };
  thrustersOffMuzzleOff: { url: string };
}

export interface ShipState {
  physics: ShipPhysics;
  // Sprite variants (present when generated or defaulted)
  sprites: ShipSprites;
  // Resized sprite variants (always preferred by server & clients). Mirrors keys of `sprites`.
  resizedSprites: ShipSprites;
  /** Generated display name for the ship (from name-ship service or default fallback) */
  name: string;
  /** Current hit points; new ships start at 100 */
  health: number;
  /** Number of enemy ships this ship has destroyed; starts at 0 */
  kills: number;
  /** Local-space (image-centered) offsets where projectiles should originate.
   *  Computed after sprite-sheet expansion by diffing thrustersOnMuzzleOff vs thrustersOnMuzzleOn.
   *  Each origin is (x,y) in original (non-resized) image pixels relative to image center
   *  (i.e. image center = 0,0; +x right; +y down). When firing we rotate + translate into world space
   *  and also push slightly forward along the ship's forward vector. */
  bulletOrigins: Vector2[];
  appearance: {
    shipImageUrl: string;
  };
  /** Epoch ms updated by server whenever a client update or simulation tick modifies the ship */
  lastUpdatedAt: number;
}

export interface GameState {
  ships: Record<EntityId, ShipState>;
  /** Active projectiles in the world */
  projectiles: ProjectileState[];
}

export interface ShipPhysics {
  position: Vector2;
  rotation: number;
  velocity?: Vector2; // linear velocity (units/s)
}

export interface ProjectileState {
  id: string;
  ownerId: EntityId;
  position: Vector2;
  velocity: Vector2;
  rotation: number; // for client-side orientation (rad)
  createdAt: number; // epoch ms
}
