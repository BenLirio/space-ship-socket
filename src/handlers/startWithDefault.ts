import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from '../types/messages.js';
import { broadcast, sendJson } from '../socketUtils.js';
import type { CustomWebSocket } from '../types/socket.js';
import type { ShipState } from '../types/game.js';
import { getGameState } from '../game/loop.js';

// Default full-size (original) sprite variants pulled from captured gameState sample
// These are the "generated" originals (non-resized) for each state.
const DEFAULT_FULL_SPRITES = {
  thrustersOnMuzzleOff: {
    url: 'https://space-ship-sprites.s3.amazonaws.com/generated/6c3d3780-44be-4158-9f40-b194af7a5f75.png',
  },
  thrustersOnMuzzleOn: {
    url: 'https://space-ship-sprites.s3.amazonaws.com/generated/6c3d3780-44be-4158-9f40-b194af7a5f75-thrustersOn-muzzleOn.png',
  },
  thrustersOffMuzzleOn: {
    url: 'https://space-ship-sprites.s3.amazonaws.com/generated/6c3d3780-44be-4158-9f40-b194af7a5f75-thrustersOff-muzzleOn.png',
  },
  thrustersOffMuzzleOff: {
    url: 'https://space-ship-sprites.s3.amazonaws.com/generated/6c3d3780-44be-4158-9f40-b194af7a5f75-thrustersOff-muzzleOff.png',
  },
} as const;

// Corresponding resized sprite variants (preferred by clients)
const DEFAULT_RESIZED_SPRITES = {
  thrustersOnMuzzleOff: {
    url: 'https://space-ship-sprites.s3.amazonaws.com/resized/1ae92aa5ac921cba17f46bf51179c02b2888305d.png',
  },
  thrustersOnMuzzleOn: {
    url: 'https://space-ship-sprites.s3.amazonaws.com/resized/85b7e120b0d9396f04cc71c78ecc4579a1a37df0.png',
  },
  thrustersOffMuzzleOn: {
    url: 'https://space-ship-sprites.s3.amazonaws.com/resized/6b0f3ae8c3ff568e9068d00afe2408e091ca3525.png',
  },
  thrustersOffMuzzleOff: {
    url: 'https://space-ship-sprites.s3.amazonaws.com/resized/30a91441fd699007c30a9fbe41388e3689b74a5a.png',
  },
} as const;

// Bullet origins (already scaled to resized 128x128 space) captured from sample
// These represent local-space offsets (image center = 0,0; +y down) for projectile spawn.
const DEFAULT_BULLET_ORIGINS = [
  { x: 20.9375, y: -20.125 },
  { x: -20.75, y: -20.1875 },
] as const;

interface StartWithDefaultBody {
  userId?: string; // optional explicit user id (falls back to socket id)
}

export function handleStartWithDefault(
  wss: WebSocketServer,
  socket: WebSocket,
  msg: IncomingMessage,
) {
  const gameState = getGameState();
  if (!gameState) return; // defensive

  const body = (msg as { body?: unknown }).body as StartWithDefaultBody | undefined;
  const targetId =
    body?.userId && typeof body.userId === 'string' ? body.userId : (socket as CustomWebSocket).id;

  const ship: ShipState = {
    physics: { position: { x: 0, y: 0 }, rotation: 0 },
    sprites: { ...DEFAULT_FULL_SPRITES },
    resizedSprites: { ...DEFAULT_RESIZED_SPRITES },
    health: 100,
    bulletOrigins: [...DEFAULT_BULLET_ORIGINS],
    appearance: { shipImageUrl: DEFAULT_RESIZED_SPRITES.thrustersOffMuzzleOff.url },
    lastUpdatedAt: Date.now(),
  };

  gameState.ships[targetId] = ship;

  // Broadcast updated game state immediately so the requester (and others) see the new ship without waiting for tick
  broadcast(wss, { type: 'gameState', payload: gameState });
  // Optional ack just to inform the caller (non-critical)
  sendJson(socket, { type: 'info', payload: `default ship created for ${targetId}` });
}
