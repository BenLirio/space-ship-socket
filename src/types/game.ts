export type EntityId = string;

export interface Vector2 {
  x: number;
  y: number;
}

// Sprite variants keyed by state name (matches generator response "sprites")
export interface ShipSprites {
  // Canonical sprite variant keys (v2.0.0+)
  thrustersOnMuzzleOn?: { url: string };
  thrustersOffMuzzleOn?: { url: string };
  thrustersOnMuzzleOff?: { url: string };
  thrustersOffMuzzleOff?: { url: string };
  [k: string]: { url: string } | undefined; // allow future expansion
}

export interface ShipState {
  physics: ShipPhysics;
  // Optional sprite variants (present when generated via prompt endpoint)
  sprites?: ShipSprites;
  appearance: {
    shipImageUrl: string;
  };
  /** Epoch ms updated by server whenever a shipState message is received */
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
