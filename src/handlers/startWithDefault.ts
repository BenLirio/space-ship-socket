import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from '../types/messages.js';
import { broadcast, sendJson } from '../socketUtils.js';
import type { CustomWebSocket } from '../types/socket.js';
import type { ShipState } from '../types/game.js';
import { getGameState } from '../gameLoop.js';

// Default generated sprites (four variants)
const DEFAULT_SHIP_SPRITES = {
  trustersOnMuzzleOn: {
    url: 'https://space-ship-sprites.s3.amazonaws.com/generated/d3a3bb9e-5617-434b-a505-332c84c41f8b.png',
  },
  trustersOfMuzzleOn: {
    url: 'https://space-ship-sprites.s3.amazonaws.com/generated/d3a3bb9e-5617-434b-a505-332c84c41f8b-thrustersOff-muzzleOn.png',
  },
  thrustersOnMuzzleOf: {
    url: 'https://space-ship-sprites.s3.amazonaws.com/generated/d3a3bb9e-5617-434b-a505-332c84c41f8b-thrustersOn-muzzleOff.png',
  },
  thrustersOfMuzzleOf: {
    url: 'https://space-ship-sprites.s3.amazonaws.com/generated/d3a3bb9e-5617-434b-a505-332c84c41f8b-thrustersOff-muzzleOff.png',
  },
} as const;

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
    sprites: { ...DEFAULT_SHIP_SPRITES },
    appearance: { shipImageUrl: DEFAULT_SHIP_SPRITES.thrustersOfMuzzleOf.url },
    lastUpdatedAt: Date.now(),
  };

  gameState.ships[targetId] = ship;

  // Broadcast updated game state immediately so the requester (and others) see the new ship without waiting for tick
  broadcast(wss, { type: 'gameState', payload: gameState });
  // Optional ack just to inform the caller (non-critical)
  sendJson(socket, { type: 'info', payload: `default ship created for ${targetId}` });
}
