import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from '../types/messages.js';
import type { CustomWebSocket } from '../types/socket.js';
import { getGameState } from '../gameLoop.js';

// --- Simple movement tuning (keep intentionally small & clear) ---
const MAX_FRAME_SECONDS = 0.25; // clamp huge pauses
const THRUST_ACCEL = 180; // units / s^2 when full forward
const MAX_SPEED = 260; // hard clamp so analog & keyboard equal
const ROTATE_SPEED = Math.PI; // rad / s at full rotate input (A/D or stick X)
const LINEAR_DAMPING = 0.9; // applied each frame (approx) when no thrust
const STICK_DEADZONE = 0.15; // radial deadzone

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
    keysDown?: unknown; // (client Set serialized as array)
    joystick?: unknown; // { x:number, y:number }
  }
  const p = payload as InputPayloadShape;
  const keysDown = Array.isArray(p.keysDown)
    ? p.keysDown.filter((k): k is string => typeof k === 'string')
    : p.keysDown instanceof Set
      ? Array.from(p.keysDown).filter((k): k is string => typeof k === 'string')
      : [];
  let stickX = 0;
  let stickY = 0;
  if (p.joystick && typeof p.joystick === 'object') {
    const j = p.joystick as Record<string, unknown>;
    if (typeof j.x === 'number') stickX = j.x;
    if (typeof j.y === 'number') stickY = j.y;
  }

  const dtSec = Math.min((now - ship.lastUpdatedAt) / 1000, MAX_FRAME_SECONDS);

  // --- Unified simple input axes ---
  // Thrust forward/back: keyboard W forward (ignore S for simplicity now except as brake),
  // analog: negative Y (up) forward intensity.
  let thrustInput = 0;
  if (keysDown.includes('W')) thrustInput = 1;
  // Allow S to apply mild reverse thrust (optional simple variant)
  if (keysDown.includes('S')) thrustInput = -1;

  // Rotation: A left, D right OR use stickX if present (stick wins if magnitude passes deadzone)
  let rotateInput = 0;
  if (keysDown.includes('A')) rotateInput -= 1;
  if (keysDown.includes('D')) rotateInput += 1;

  // If joystick active: it defines desired movement direction & magnitude (world space)
  const stickLen = Math.hypot(stickX, stickY);
  let usingStickDirectional = false;
  if (stickLen > STICK_DEADZONE) {
    usingStickDirectional = true;
    const mag = (stickLen - STICK_DEADZONE) / (1 - STICK_DEADZONE); // 0..1
    const dirX = stickX / stickLen;
    const dirY = stickY / stickLen; // y down is positive
    // Target rotation so that forward vector (rotation - PI/2) matches dir
    const targetRotation = Math.atan2(dirY, dirX) + Math.PI / 2;
    // Smooth rotate toward target (shortest angular difference)
    let diff = targetRotation - ship.physics.rotation;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxStep = ROTATE_SPEED * dtSec;
    const step = Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;
    ship.physics.rotation += step;
    // Normalize
    if (ship.physics.rotation > Math.PI) ship.physics.rotation -= Math.PI * 2;
    else if (ship.physics.rotation < -Math.PI) ship.physics.rotation += Math.PI * 2;
    // Thrust equals stick magnitude (mag). Allow reverse (stick directly opposite facing) handled by rotation convergence; no reverse thrust needed.
    thrustInput = mag; // always forward thrust in facing direction
    rotateInput = 0; // joystick supersedes explicit rotate
  }

  // Keyboard rotation only if stick not providing directional control
  if (!usingStickDirectional && rotateInput !== 0) {
    ship.physics.rotation += rotateInput * ROTATE_SPEED * dtSec;
    if (ship.physics.rotation > Math.PI) ship.physics.rotation -= Math.PI * 2;
    else if (ship.physics.rotation < -Math.PI) ship.physics.rotation += Math.PI * 2;
  }

  // Ensure velocity field
  if (!ship.physics.velocity) ship.physics.velocity = { x: 0, y: 0 };

  // --- Apply thrust (accelerates along facing) ---
  if (thrustInput !== 0) {
    const angle = ship.physics.rotation - Math.PI / 2; // 0 rad = up visually
    const forwardX = Math.cos(angle);
    const forwardY = Math.sin(angle);
    ship.physics.velocity.x += forwardX * THRUST_ACCEL * thrustInput * dtSec;
    ship.physics.velocity.y += forwardY * THRUST_ACCEL * thrustInput * dtSec;
  } else if (ship.physics.velocity) {
    // Light damping when no thrust (simple scalar)
    const dampFactor = 1 - (1 - LINEAR_DAMPING) * dtSec;
    ship.physics.velocity.x *= dampFactor;
    ship.physics.velocity.y *= dampFactor;
  }

  // Clamp speed
  const v = ship.physics.velocity;
  const speed = Math.hypot(v.x, v.y);
  if (speed > MAX_SPEED) {
    const s = MAX_SPEED / speed;
    v.x *= s;
    v.y *= s;
  }

  // Integrate position
  ship.physics.position.x += ship.physics.velocity.x * dtSec;
  ship.physics.position.y += ship.physics.velocity.y * dtSec;

  ship.lastUpdatedAt = now;
}
