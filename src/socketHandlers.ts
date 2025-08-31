import type { WebSocket } from 'ws';
import type { RawData, WebSocketServer } from 'ws';
import type { IncomingMessage } from './types/messages.js';
import { sendJson, broadcast } from './socketUtils.js';
import { handlePing } from './handlers/ping.js';
import type { GameState } from './types/game.js';

// Declare a global slot to ensure only one loop instance
declare global {
  // eslint-disable-next-line no-var
  var __SPACE_SHIP_GAME_LOOP__: { interval: NodeJS.Timer; wss: WebSocketServer } | undefined; // NOSONAR - intentional global guard
}

// Concrete handler overload resolution via narrow mapping then widened when accessed dynamically
const specificHandlers = {
  ping: handlePing,
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
    const STATIC_STATE: GameState = {
      ships: {
        'static-ship-1': {
          physics: { position: { x: 200, y: 200 }, rotation: 0 },
          appearance: {
            shipImageUrl:
              'https://space-ship-sprites.s3.amazonaws.com/generated/30c69e6e-ed68-4451-a572-fe52f238b731.png',
          },
        },
      },
    };

    const interval = setInterval(() => {
      // Broadcast static game state snapshot
      broadcast(wss, { type: 'gameState', payload: STATIC_STATE });
    }, 1000);

    // Store handle on global so repeated attach calls (e.g., tests) don't spawn extra intervals.
    // Also keep reference to clear on server close.
    globalThis.__SPACE_SHIP_GAME_LOOP__ = { interval, wss };

    wss.on('close', () => {
      clearInterval(interval);
      globalThis.__SPACE_SHIP_GAME_LOOP__ = undefined;
    });
  }
  wss.on('connection', (socket: WebSocket) => {
    console.log('New client connected');
    sendJson(socket, { type: 'info', payload: 'connected to server' });

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
