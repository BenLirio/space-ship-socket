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
}

export interface GameState {
  ships: Record<EntityId, ShipState>;
}
