import type { WebSocket } from 'ws';
import type { RawData, WebSocketServer } from 'ws';
import type { IncomingMessage } from './types/messages.js';
import { sendJson, broadcast } from './socketUtils.js';
import { handlePing } from './handlers/ping.js';
import { handleShipState } from './handlers/shipState.js';
import type { GameState } from './types/game.js';
import type { CustomWebSocket } from './types/socket.js';
import { randomUUID } from 'crypto';

// Declare a global slot to ensure only one loop instance
interface GlobalLoopState {
  interval: NodeJS.Timer;
  wss: WebSocketServer;
  gameState: GameState;
}
declare global {
  var __SPACE_SHIP_GAME_LOOP__: GlobalLoopState | undefined; // NOSONAR - intentional global guard
}

// Concrete handler overload resolution via narrow mapping then widened when accessed dynamically
const specificHandlers = {
  ping: handlePing,
  shipState: handleShipState,
};
const handlers: Record<
  string,
  (wss: WebSocketServer, socket: WebSocket, msg: IncomingMessage) => void
> = specificHandlers as Record<
  string,
  (wss: WebSocketServer, socket: WebSocket, msg: IncomingMessage) => void
>;

function isIncomingMessage(value: unknown): value is IncomingMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === 'string';
}

export function attachSocketHandlers(wss: WebSocketServer) {
  // Start a single game loop broadcaster (idempotent if called multiple times for different servers in tests)
  if (!globalThis.__SPACE_SHIP_GAME_LOOP__) {
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
        // Optionally log purge for observability
        console.log(`[gameLoop] Purged ${purged} stale ship(s)`);
      }
      // Periodic broadcast snapshot (post-purge)
      broadcast(wss, { type: 'gameState', payload: dynamicState });
    }, 1000); // TODO: tune tick rate

    globalThis.__SPACE_SHIP_GAME_LOOP__ = { interval, wss, gameState: dynamicState };

    wss.on('close', () => {
      clearInterval(interval);
      globalThis.__SPACE_SHIP_GAME_LOOP__ = undefined;
    });
  }
  wss.on('connection', (socket: CustomWebSocket) => {
    socket.id = randomUUID();
    console.log(`New client connected: ${socket.id}`);
    sendJson(socket, { type: 'info', payload: 'connected to server' });
    sendJson(socket, { type: 'connected', payload: { id: socket.id } });

    socket.on('message', (data: RawData) => {
      const text = data.toString();
      let parsed: unknown;

      try {
        parsed = JSON.parse(text);
      } catch {
        return sendJson(socket, { type: 'error', payload: 'invalid JSON' });
      }

      if (!isIncomingMessage(parsed)) {
        return sendJson(socket, {
          type: 'error',
          payload: 'message must have a string "type" field',
        });
      }

      const handler = handlers[parsed.type];
      if (!handler) {
        return sendJson(socket, { type: 'error', payload: `unknown message type: ${parsed.type}` });
      }

      try {
        handler(wss, socket, parsed);
      } catch (err) {
        console.error('handler error for type', parsed.type, err);
        return sendJson(socket, { type: 'error', payload: 'internal handler error' });
      }
    });

    socket.on('close', () => {
      /* no-op (client count broadcast removed) */
    });
  });

  wss.on('error', (err) => {
    console.error('WebSocket server error', err);
  });
}
