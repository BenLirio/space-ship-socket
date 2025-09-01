import type { WebSocketServer } from 'ws';
import { broadcast } from './socketUtils.js';
import type { GameState, ShipState } from './types/game.js';

// ---------------------------------------------------------------------------
// Authoritative simulation + broadcast loops
//  - 60Hz simulation (physics + applying latest inputs)
//  - 30Hz broadcast of the authoritative snapshot to all clients
//  - Input handlers only record latest input; no direct physics mutation
// ---------------------------------------------------------------------------

// Physics / movement tuning (moved from input handler)
const THRUST_ACCEL = 180; // units / s^2 when full forward
const MAX_SPEED = 260; // hard clamp so analog & keyboard equal
const ROTATE_SPEED = Math.PI; // rad / s at full rotate input
const LINEAR_DAMPING = 0.9; // approx damping factor when coasting
const STICK_DEADZONE = 0.15; // radial deadzone for analog stick

interface InputState {
  keysDown: Set<string>;
  joystick?: { x: number; y: number }; // raw input -y = up (client dependent)
  lastInputAt: number; // epoch ms
}

interface InternalLoopState {
  simInterval: NodeJS.Timeout;
  broadcastInterval: NodeJS.Timeout;
  wss: WebSocketServer;
  gameState: GameState; // authoritative snapshot we broadcast
  inputs: Record<string, InputState>; // latest input per entity id
}

let loop: InternalLoopState | undefined; // internal singleton

export function getGameState(): GameState | undefined {
  return loop?.gameState;
}

/** Record (overwrite) the latest input for a given entity. */
export function recordInput(
  entityId: string,
  partial: {
    keysDown?: Iterable<string> | string[];
    joystick?: { x?: unknown; y?: unknown } | undefined;
  },
) {
  if (!loop) return; // not started yet
  const now = Date.now();
  let existing = loop.inputs[entityId];
  if (!existing) {
    existing = loop.inputs[entityId] = { keysDown: new Set(), lastInputAt: now };
  }
  // Normalize keys
  if (partial.keysDown) {
    const arr = Array.from(partial.keysDown).filter((k): k is string => typeof k === 'string');
    existing.keysDown = new Set(arr);
  }
  if (partial.joystick && typeof partial.joystick === 'object') {
    const jx = typeof partial.joystick.x === 'number' ? partial.joystick.x : 0;
    const jy = typeof partial.joystick.y === 'number' ? partial.joystick.y : 0;
    existing.joystick = { x: jx, y: jy };
  }
  existing.lastInputAt = now;
}

export function initGameLoop(wss: WebSocketServer): InternalLoopState {
  if (loop) return loop;

  const gameState: GameState = { ships: {} };
  const inputs: Record<string, InputState> = {};

  // Simulation timing
  const SIM_HZ = 60;
  const SIM_DT = 1 / SIM_HZ; // seconds per fixed tick
  const BROADCAST_HZ = 30;
  const BROADCAST_MS = 1000 / BROADCAST_HZ;
  const EXPIRY_MS = 5000; // inactivity purge threshold

  function simulateShip(ship: ShipState, input: InputState | undefined) {
    // Provide defaults when no input yet
    const keysDown = input?.keysDown ?? new Set<string>();
    const joystick = input?.joystick;

    // --- Input interpretation (mirrors old handler logic) ---
    let thrustInput = 0; // -1..1
    if (keysDown.has('W')) thrustInput = 1;
    if (keysDown.has('S')) thrustInput = -1; // simple reverse
    let rotateInput = 0; // -1 left, +1 right
    if (keysDown.has('A')) rotateInput -= 1;
    if (keysDown.has('D')) rotateInput += 1;

    let stickX = 0;
    let stickY = 0;
    if (joystick) {
      stickX = joystick.x;
      stickY = joystick.y;
    }

    const stickLen = Math.hypot(stickX, stickY);
    let usingStickDirectional = false;
    if (stickLen > STICK_DEADZONE) {
      usingStickDirectional = true;
      const mag = (stickLen - STICK_DEADZONE) / (1 - STICK_DEADZONE); // 0..1
      const dirX = stickX / stickLen;
      const dirY = stickY / stickLen;
      const targetRotation = Math.atan2(dirY, dirX) + Math.PI / 2;
      // Smooth rotate toward target (shortest angular difference)
      let diff = targetRotation - ship.physics.rotation;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const maxStep = ROTATE_SPEED * SIM_DT;
      const step = Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;
      ship.physics.rotation += step;
      if (ship.physics.rotation > Math.PI) ship.physics.rotation -= Math.PI * 2;
      else if (ship.physics.rotation < -Math.PI) ship.physics.rotation += Math.PI * 2;
      thrustInput = mag;
      rotateInput = 0; // joystick overrides keyboard rotation
    }

    if (!usingStickDirectional && rotateInput !== 0) {
      ship.physics.rotation += rotateInput * ROTATE_SPEED * SIM_DT;
      if (ship.physics.rotation > Math.PI) ship.physics.rotation -= Math.PI * 2;
      else if (ship.physics.rotation < -Math.PI) ship.physics.rotation += Math.PI * 2;
    }

    if (!ship.physics.velocity) ship.physics.velocity = { x: 0, y: 0 };
    const v = ship.physics.velocity;

    const thrustActive = thrustInput !== 0;
    // Apply thrust
    if (thrustActive) {
      const angle = ship.physics.rotation - Math.PI / 2; // align with previous logic
      const forwardX = Math.cos(angle);
      const forwardY = Math.sin(angle);
      v.x += forwardX * THRUST_ACCEL * thrustInput * SIM_DT;
      v.y += forwardY * THRUST_ACCEL * thrustInput * SIM_DT;
    } else {
      // Damping when coasting (frame-rate independent-ish)
      const dampFactor = 1 - (1 - LINEAR_DAMPING) * SIM_DT;
      v.x *= dampFactor;
      v.y *= dampFactor;
    }

    // Clamp speed
    const speed = Math.hypot(v.x, v.y);
    if (speed > MAX_SPEED) {
      const s = MAX_SPEED / speed;
      v.x *= s;
      v.y *= s;
    }

    // Integrate position
    // If the sim hiccups badly we could scale by a clamped actual dt; we keep fixed-step for determinism.
    v.x = Number.isFinite(v.x) ? v.x : 0;
    v.y = Number.isFinite(v.y) ? v.y : 0;
    ship.physics.position.x += v.x * SIM_DT;
    ship.physics.position.y += v.y * SIM_DT;

    // Dynamic sprite selection each sim tick (if sprites present)
    if (ship.sprites) {
      const thrustersUrl = ship.sprites.state.thrusters?.url;
      const idleUrl = ship.sprites.state.idle?.url;
      if (thrustActive && thrustersUrl) {
        if (ship.appearance.shipImageUrl !== thrustersUrl) {
          ship.appearance.shipImageUrl = thrustersUrl;
        }
      } else if (idleUrl) {
        if (ship.appearance.shipImageUrl !== idleUrl) {
          ship.appearance.shipImageUrl = idleUrl;
        }
      }
    }

    ship.lastUpdatedAt = Date.now();
  }

  const simInterval = setInterval(() => {
    // Run physics for each ship
    for (const [id, ship] of Object.entries(gameState.ships)) {
      const input = inputs[id];
      simulateShip(ship, input);
    }
    // Purge ships whose last input is too old (avoid permanent ghosts)
    const now = Date.now();
    let purged = 0;
    for (const [id, input] of Object.entries(inputs)) {
      if (now - input.lastInputAt > EXPIRY_MS) {
        delete inputs[id];
        delete gameState.ships[id];
        purged++;
      }
    }
    if (purged) console.log(`[sim] Purged ${purged} inactive ship(s)`);
  }, 1000 / SIM_HZ);

  const broadcastInterval = setInterval(() => {
    broadcast(wss, { type: 'gameState', payload: gameState });
  }, BROADCAST_MS);

  loop = { simInterval, broadcastInterval, wss, gameState, inputs };

  wss.on('close', () => stopGameLoop());
  return loop;
}

export function stopGameLoop() {
  if (!loop) return;
  clearInterval(loop.simInterval);
  clearInterval(loop.broadcastInterval);
  loop = undefined;
}
