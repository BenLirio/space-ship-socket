import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from '../types/messages.js';
import { broadcast, sendJson } from '../socketUtils.js';
import type { CustomWebSocket } from '../types/socket.js';
import type { ShipState } from '../types/game.js';
import { getGameState } from '../gameLoop.js';

// Constant default ship image URL provided per requirements
const DEFAULT_SHIP_IMAGE_URL =
  'https://space-ship-sprites.s3.us-east-1.amazonaws.com/generated/0527922c-3c69-493e-8528-cd65cb5ee06a.png';

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
    physics: {
      position: { x: 0, y: 0 },
      rotation: 0,
    },
    appearance: { shipImageUrl: DEFAULT_SHIP_IMAGE_URL },
    lastUpdatedAt: Date.now(),
  };

  gameState.ships[targetId] = ship;

  // Broadcast updated game state immediately so the requester (and others) see the new ship without waiting for tick
  broadcast(wss, { type: 'gameState', payload: gameState });
  // Optional ack just to inform the caller (non-critical)
  sendJson(socket, { type: 'info', payload: `default ship created for ${targetId}` });
}
