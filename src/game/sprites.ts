import type { ShipSprites } from '../types/game.js';

export function preferredSpriteUrl(sprites: ShipSprites): string {
  return (
    sprites.thrustersOffMuzzleOff?.url ||
    sprites.thrustersOffMuzzleOn?.url ||
    sprites.thrustersOnMuzzleOff?.url ||
    sprites.thrustersOnMuzzleOn?.url
  );
}
