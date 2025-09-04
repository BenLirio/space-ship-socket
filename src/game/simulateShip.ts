import type { ShipState } from '../types/game.js';
import { spawnProjectile } from './projectiles.js';
import {
  FIRE_COOLDOWN_MS,
  LINEAR_DAMPING,
  MAX_SPEED,
  MUZZLE_FLASH_DURATION_MS,
  ROTATE_SPEED,
  SIM_DT,
  STICK_DEADZONE,
  THRUST_ACCEL,
} from './constants.js';
import type { InputState, InternalLoopState } from './types.js';

export function simulateShip(
  loop: InternalLoopState,
  ship: ShipState,
  input: InputState | undefined,
) {
  // Provide defaults when no input yet
  const keysDown = input?.keysDown ?? new Set<string>();
  const joystick = input?.joystick;

  // (Time-based muzzle flash handled via muzzleFlashUntil timestamp)

  // --- Input interpretation ---
  let thrustInput = 0; // 0..1 forward thrust only
  let braking = false; // user holding S to actively slow down
  if (keysDown.has('W')) thrustInput = 1;
  if (keysDown.has('S')) braking = true; // new braking behavior instead of reverse thrust
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
  // Apply thrust (forward only)
  if (thrustActive) {
    const angle = ship.physics.rotation - Math.PI / 2; // align with previous logic
    const forwardX = Math.cos(angle);
    const forwardY = Math.sin(angle);
    v.x += forwardX * THRUST_ACCEL * thrustInput * SIM_DT;
    v.y += forwardY * THRUST_ACCEL * thrustInput * SIM_DT;
  }

  // Braking (S key): apply an opposing acceleration proportional to current velocity.
  // This feels like holding space brakes in Asteroids: stronger than passive damping
  if (braking) {
    const speed = Math.hypot(v.x, v.y);
    if (speed > 0.0001) {
      // Choose a brake accel somewhat larger than natural damping equivalent.
      // Reuse THRUST_ACCEL so stopping time is comparable to accelerating time.
      const brakeAccel = THRUST_ACCEL * 1.2; // slight boost for snappier stop
      const decel = brakeAccel * SIM_DT;
      const newSpeed = speed - decel;
      const scale = Math.max(newSpeed, 0) / speed;
      v.x *= scale;
      v.y *= scale;
    }
  }

  // Passive damping only when not thrusting and not actively braking (braking already reduces speed)
  if (!thrustActive && !braking) {
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
  v.x = Number.isFinite(v.x) ? v.x : 0;
  v.y = Number.isFinite(v.y) ? v.y : 0;
  ship.physics.position.x += v.x * SIM_DT;
  ship.physics.position.y += v.y * SIM_DT;

  // Dynamic sprite selection each sim tick using resizedSprites only
  if (ship.resizedSprites) {
    const now = Date.now();
    const muzzleActive =
      !!input && input.muzzleFlashUntil !== undefined && now < input.muzzleFlashUntil;

    const variantOrder: { thrust: boolean; muzzle: boolean; keys: string[] }[] = [
      { thrust: true, muzzle: true, keys: ['thrustersOnMuzzleOn'] },
      { thrust: false, muzzle: true, keys: ['thrustersOffMuzzleOn'] },
      { thrust: true, muzzle: false, keys: ['thrustersOnMuzzleOff'] },
      { thrust: false, muzzle: false, keys: ['thrustersOffMuzzleOff'] },
    ];

    function resolveVariant(thrust: boolean, muzzle: boolean): { url: string } | undefined {
      for (const v of variantOrder) {
        if (v.thrust === thrust && v.muzzle === muzzle) {
          for (const key of v.keys) {
            const found = (ship.resizedSprites as Record<string, { url: string } | undefined>)[key];
            if (found?.url) return found;
          }
        }
      }
      return undefined;
    }

    let variant = resolveVariant(thrustActive, muzzleActive);
    if (!variant && muzzleActive) variant = resolveVariant(thrustActive, false);
    if (!variant) variant = resolveVariant(false, false) || resolveVariant(true, false);

    if (variant && variant.url && ship.appearance.shipImageUrl !== variant.url) {
      ship.appearance.shipImageUrl = variant.url;
    }
  }

  // Firing logic
  if (input && input.keysDown.has('SPACE')) {
    const now = Date.now();
    if (!input.lastFireAt || now - input.lastFireAt >= FIRE_COOLDOWN_MS) {
      input.lastFireAt = now;
      spawnProjectile(loop, ship);
      input.muzzleFlashUntil = now + MUZZLE_FLASH_DURATION_MS;
    }
  }

  ship.lastUpdatedAt = Date.now();
}
