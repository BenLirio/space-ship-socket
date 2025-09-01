// Game simulation constants
export const THRUST_ACCEL = 180; // units / s^2 when full forward
export const MAX_SPEED = 260; // hard clamp so analog & keyboard equal
export const ROTATE_SPEED = Math.PI; // rad / s at full rotate input
export const LINEAR_DAMPING = 0.9; // approx damping factor when coasting
export const STICK_DEADZONE = 0.15; // radial deadzone for analog stick
export const MUZZLE_FLASH_DURATION_MS = Number(process.env.MUZZLE_FLASH_DURATION_MS) || 150; // visible window
export const FIRE_RATE_HZ = 4;
export const FIRE_COOLDOWN_MS = 1000 / FIRE_RATE_HZ;
export const PROJECTILE_SPEED = 600; // units/s
export const PROJECTILE_LIFETIME_MS = 3000; // ms before auto-despawn
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ; // fixed-step dt seconds
export const BROADCAST_HZ = 30;
export const BROADCAST_MS = 1000 / BROADCAST_HZ;
export const SHIP_EXPIRY_MS = 5000; // inactivity purge threshold
