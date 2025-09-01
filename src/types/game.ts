export type EntityId = string;

export interface Vector2 {
  x: number;
  y: number;
}

// Sprite variants keyed by state name (matches generator response "sprites")
export interface ShipSprites {
  idle?: { url: string };
  thrusters?: { url: string };
  [k: string]: { url: string } | undefined; // future expansion
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
}

export interface ShipPhysics {
  position: Vector2;
  rotation: number;
  velocity?: Vector2; // linear velocity (units/s)
}
