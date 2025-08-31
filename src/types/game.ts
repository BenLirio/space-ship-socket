export type EntityId = string;

export interface Vector2 {
  x: number;
  y: number;
}

export interface ShipState {
  physics: {
    position: Vector2;
    rotation: number;
  };
  appearance: {
    shipImageUrl: string;
  };
  /** Epoch ms updated by server whenever a shipState message is received */
  lastUpdatedAt: number;
}

export interface GameState {
  ships: Record<EntityId, ShipState>;
}
