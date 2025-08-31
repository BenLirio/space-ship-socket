import type { WebSocketServer } from 'ws';
import { broadcast } from './socketUtils.js';
import type { GameState } from './types/game.js';

// Module-scoped singleton state (ESM modules are single-instanced per process) so we avoid globalThis.
// This keeps test idempotency while avoiding polluting the global namespace.
interface GlobalLoopState {
  interval: NodeJS.Timeout;
  wss: WebSocketServer;
  gameState: GameState;
}

let currentLoop: GlobalLoopState | undefined; // internal module singleton

/** Returns the active game state object (mutable). Undefined if loop not started yet. */
export function getGameState(): GameState | undefined {
  return currentLoop?.gameState;
}

/** Starts the game loop if not already running and returns the loop state. */
export function initGameLoop(wss: WebSocketServer): GlobalLoopState {
  if (currentLoop) return currentLoop;

  const dynamicState: GameState = { ships: {} };
  const interval = setInterval(() => {
    // Purge stale ships before broadcasting
    const now = Date.now();
    const EXPIRY_MS = 5000;
    let purged = 0;
    for (const [id, ship] of Object.entries(dynamicState.ships)) {
      if (now - ship.lastUpdatedAt > EXPIRY_MS) {
        delete dynamicState.ships[id];
        purged++;
      }
    }
    if (purged) {
      console.log(`[gameLoop] Purged ${purged} stale ship(s)`);
    }
    broadcast(wss, { type: 'gameState', payload: dynamicState });
  }, 1000);

  currentLoop = { interval, wss, gameState: dynamicState };

  wss.on('close', () => stopGameLoop());

  return currentLoop;
}

/** Stops the loop if running. */
export function stopGameLoop() {
  if (!currentLoop) return;
  clearInterval(currentLoop.interval);
  currentLoop = undefined;
}
