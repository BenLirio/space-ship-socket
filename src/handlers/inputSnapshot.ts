import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from '../types/messages.js';
import type { CustomWebSocket } from '../types/socket.js';
import { getGameState } from '../gameLoop.js';

// Tunable physics constants (simple placeholder values)
const MAX_FRAME_SECONDS = 0.25; // clamp huge pauses (avoid teleport)
const FORWARD_SPEED_UNITS_PER_SEC = 120; // arbitrary world units / second when holding 'W'
const ROTATE_SPEED_RADS_PER_SEC = Math.PI; // 180 degrees per second

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

  const now = Date.now();

  // Movement: if 'W' is currently pressed, advance ship forward in the direction of its rotation.
  // Rotation is interpreted in radians (0 radians points along +X, increasing CCW) – adjust client to match.
  interface InputPayloadShape {
    keysDown?: unknown;
  }
  const p = payload as InputPayloadShape;
  const keysDown = Array.isArray(p.keysDown)
    ? p.keysDown.filter((k): k is string => typeof k === 'string')
    : [];

  const dtSec = Math.min((now - ship.lastUpdatedAt) / 1000, MAX_FRAME_SECONDS);

  // Rotation: 'A' = rotate left (counter-clockwise), 'D' = rotate right (clockwise) in screen space
  // With our convention (0 rad = up after shift), increasing rotation yields clockwise turn visually.
  const rotatingLeft = keysDown.includes('A');
  const rotatingRight = keysDown.includes('D');
  if (rotatingLeft !== rotatingRight) {
    const dir = rotatingRight ? 1 : -1; // right => +, left => -
    ship.physics.rotation += dir * ROTATE_SPEED_RADS_PER_SEC * dtSec;
    // Normalize to [-PI, PI] for numeric stability
    if (ship.physics.rotation > Math.PI) ship.physics.rotation -= Math.PI * 2;
    else if (ship.physics.rotation < -Math.PI) ship.physics.rotation += Math.PI * 2;
  }

  if (keysDown.includes('W')) {
    // Forward movement uses (rotation - 90°) so rotation 0 points up (negative Y)
    const angle = ship.physics.rotation - Math.PI / 2; // radians
    const forwardX = Math.cos(angle);
    const forwardY = Math.sin(angle);
    ship.physics.position.x += forwardX * FORWARD_SPEED_UNITS_PER_SEC * dtSec;
    ship.physics.position.y += forwardY * FORWARD_SPEED_UNITS_PER_SEC * dtSec;
  }

  ship.lastUpdatedAt = now;
  // No immediate broadcast needed: regular game loop tick will include updated state.
}
