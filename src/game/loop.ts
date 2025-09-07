import type { WebSocketServer } from 'ws';
import { broadcast } from '../socketUtils.js';
import type { GameState } from '../types/game.js';
import { BROADCAST_MS, SHIP_EXPIRY_MS, SIM_DT, SIM_HZ } from './constants.js';
import type { InternalLoopState, InputState } from './types.js';
import { simulateShip } from './simulateShip.js';
import { simulateProjectiles } from './projectiles.js';

let loop: InternalLoopState | undefined;

export function getGameState(): GameState | undefined {
  return loop?.gameState;
}

export function recordInput(
  entityId: string,
  partial: {
    keysDown?: Iterable<string> | string[];
    joystick?: { x?: unknown; y?: unknown } | undefined;
  },
) {
  if (!loop) return;
  const now = Date.now();
  let existing = loop.inputs[entityId];
  if (!existing) existing = loop.inputs[entityId] = { keysDown: new Set(), lastInputAt: now };
  const ship = loop.gameState.ships[entityId];
  const dead = !!ship && ship.health <= 0;
  if (dead) {
    // Do not register any input when ship is destroyed
    existing.keysDown = new Set();
    existing.joystick = { x: 0, y: 0 };
  } else {
    if (partial.keysDown) {
      const arr = Array.from(partial.keysDown).filter((k): k is string => typeof k === 'string');
      existing.keysDown = new Set(arr);
    }
    if (partial.joystick && typeof partial.joystick === 'object') {
      const jx = typeof partial.joystick.x === 'number' ? partial.joystick.x : 0;
      const jy = typeof partial.joystick.y === 'number' ? partial.joystick.y : 0;
      existing.joystick = { x: jx, y: jy };
    }
  }
  existing.lastInputAt = now;
}

export function initGameLoop(wss: WebSocketServer): InternalLoopState {
  if (loop) return loop;
  const gameState: GameState = { ships: {}, projectiles: [] };
  const inputs: Record<string, InputState> = {};

  const simInterval = setInterval(() => {
    Object.entries(gameState.ships).forEach(([id, ship]) => simulateShip(loop!, ship, inputs[id]));
    simulateProjectiles(loop!, SIM_DT);
    const now = Date.now();
    let purged = 0;
    Object.entries(inputs).forEach(([id, input]) => {
      if (now - input.lastInputAt > SHIP_EXPIRY_MS) {
        delete inputs[id];
        delete gameState.ships[id];
        purged++;
      }
    });
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
