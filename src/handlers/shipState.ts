import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from '../types/messages.js';
import { sendJson, broadcast } from '../socketUtils.js';
import type { ShipState } from '../types/game.js';
import type { CustomWebSocket } from '../types/socket.js';

function isVector2(v: unknown): v is { x: number; y: number } {
  if (!v || typeof v !== 'object') return false;
  const rec = v as Record<string, unknown>;
  return typeof rec.x === 'number' && typeof rec.y === 'number';
}

// Validate only the client-provided subset (without lastUpdatedAt which server injects)
function isShipState(p: unknown): p is Omit<ShipState, 'lastUpdatedAt'> {
  const obj = p as Record<string, unknown>;
  if (!obj || typeof obj !== 'object') return false;
  const physics = obj.physics as Record<string, unknown> | undefined;
  const appearance = obj.appearance as Record<string, unknown> | undefined;
  if (!physics || !appearance) return false;
  if (typeof physics.rotation !== 'number') return false;
  if (!isVector2(physics.position)) return false;
  if (typeof appearance.shipImageUrl !== 'string') return false;
  return true;
}

export function handleShipState(wss: WebSocketServer, socket: WebSocket, msg: IncomingMessage) {
  const payload = (msg as { payload?: unknown }).payload;
  if (!isShipState(payload)) {
    return sendJson(socket, { type: 'error', payload: 'invalid shipState payload' });
  }
  if (!globalThis.__SPACE_SHIP_GAME_LOOP__) return; // Should not happen, defensive
  const gameState = globalThis.__SPACE_SHIP_GAME_LOOP__.gameState;
  const entityId = (socket as CustomWebSocket).id;
  const enriched: ShipState = { ...payload, lastUpdatedAt: Date.now() };
  gameState.ships[entityId] = enriched;
  // Immediately broadcast updated snapshot (could be throttled if needed)
  broadcast(wss, { type: 'gameState', payload: gameState });
}
