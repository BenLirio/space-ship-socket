import type { WebSocket } from 'ws';
import type { RawData, WebSocketServer } from 'ws';
import type { IncomingMessage } from './types/messages.js';
import { sendJson } from './socketUtils.js';
import { handlePing } from './handlers/ping.js';
import { handleStartWithDefault } from './handlers/startWithDefault.js';
import { handleStartWithPrompt } from './handlers/startWithPrompt.js';
import { handleInputSnapshot } from './handlers/inputSnapshot.js';
import type { CustomWebSocket } from './types/socket.js';
import { randomUUID } from 'crypto';
import { initGameLoop } from './game/loop.js';
import { scoreboardList } from './services/scoreboard.js';

// Concrete handler overload resolution via narrow mapping then widened when accessed dynamically
const specificHandlers = {
  ping: handlePing,
  startWithDefault: handleStartWithDefault,
  startWithPrompt: handleStartWithPrompt,
  inputSnapshot: handleInputSnapshot,
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
  // Ensure the game loop is running (idempotent)
  initGameLoop(wss);
  wss.on('connection', (socket: CustomWebSocket) => {
    socket.id = randomUUID();
    console.log(`New client connected: ${socket.id}`);
    sendJson(socket, { type: 'info', payload: 'connected to server' });
    sendJson(socket, { type: 'connected', payload: { id: socket.id } });

    // Fire-and-forget: fetch current scoreboard and send only to this client.
    // Errors are swallowed to avoid impacting connection flow (useful in dev/tests).
    void (async () => {
      try {
        const list = await scoreboardList(25);
        if (list) sendJson(socket, { type: 'scoreboard', payload: list });
      } catch (err) {
        // non-fatal
        console.warn('[scoreboard] list on join failed', err);
      }
    })();

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

    // No cleanup needed on close currently
    socket.on('close', () => undefined);
  });
}
