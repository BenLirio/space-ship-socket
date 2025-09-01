import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from '../types/messages.js';
import type { CustomWebSocket } from '../types/socket.js';
import { getGameState } from '../gameLoop.js';

// Minimal shape validation (optional fields ignored). We only care that it's an object.
function isInputSnapshotPayload(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

/**
 * Handles client input snapshot messages. Purpose: keep ship alive / responsive by
 * refreshing lastUpdatedAt without requiring full shipState payload each frame.
 * Requirement: Update the ship's lastUpdatedAt timestamp when this message is received.
 */
export function handleInputSnapshot(
  _wss: WebSocketServer,
  socket: WebSocket,
  msg: IncomingMessage,
) {
  const payload = (msg as { payload?: unknown }).payload;
  if (!isInputSnapshotPayload(payload)) return; // ignore malformed

  const gameState = getGameState();
  if (!gameState) return; // defensive

  const id = (socket as CustomWebSocket).id;
  const ship = gameState.ships[id];
  if (!ship) return; // If ship not created yet, silently ignore (could auto-create if desired)

  ship.lastUpdatedAt = Date.now();
  // No immediate broadcast needed: regular game loop tick will include updated timestamp.
}
