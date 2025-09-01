import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from '../types/messages.js';
import type { CustomWebSocket } from '../types/socket.js';
import { getGameState, recordInput } from '../gameLoop.js';

// Minimal shape validation (optional fields ignored). We only care that it's an object.
function isInputSnapshotPayload(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

/**
 * New authoritative model: just record the latest input. The simulation loop
 * (60Hz) consumes inputs and updates physics & positions. This handler no longer
 * mutates ship physics directly.
 */
export function handleInputSnapshot(
  _wss: WebSocketServer,
  socket: WebSocket,
  msg: IncomingMessage,
) {
  const payload = (msg as { payload?: unknown }).payload;
  if (!isInputSnapshotPayload(payload)) return; // ignore malformed

  const gameState = getGameState();
  if (!gameState) return; // defensive (should not happen if loop started)
  const id = (socket as CustomWebSocket).id;
  if (!gameState.ships[id]) return; // ship must exist first

  // Extract fields we care about, normalizing types. Accept array or Set for keysDown.
  const rawKeys = (payload as { keysDown?: unknown }).keysDown;
  let keys: string[] | undefined;
  if (Array.isArray(rawKeys)) {
    keys = rawKeys.filter((k): k is string => typeof k === 'string');
  } else if (rawKeys instanceof Set) {
    keys = Array.from(rawKeys).filter((k): k is string => typeof k === 'string');
  }

  let joystick: { x?: unknown; y?: unknown } | undefined;
  const rawJoy = (payload as { joystick?: unknown }).joystick;
  if (rawJoy && typeof rawJoy === 'object') joystick = rawJoy as { x?: unknown; y?: unknown };

  if (keys) {
    recordInput(id, { keysDown: keys, joystick });
  } else {
    recordInput(id, { joystick });
  }
}
