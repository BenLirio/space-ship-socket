export type EntityId = string;

export interface Vector2 {
  x: number;
  y: number;
}

// Full sprite generation response retained on the server so we can
// dynamically choose which image URL to broadcast each tick.
export interface ShipSprites {
  requestId: string;
  state: {
    idle?: { url: string };
    thrusters?: { url: string };
    // Allow arbitrary additional named states for future expansion
    [k: string]: { url: string } | undefined;
  };
}

export interface ShipState {
  physics: ShipPhysics;
  // Optional sprite sheet/state data (present when generated via prompt endpoint)
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
