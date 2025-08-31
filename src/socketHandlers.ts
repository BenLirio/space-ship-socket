import type { WebSocket } from 'ws';
import type { RawData, WebSocketServer } from 'ws';
import type { IncomingMessage } from './app.js';
import { sendJson } from './socketUtils.js';
import { handlePing } from './handlers/ping.js';

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
  wss.on('connection', (socket: WebSocket) => {
    console.log('New client connected');
    // (welcome + client count messages removed per specification)

    socket.on('message', (data: RawData) => {
      const text = data.toString();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        sendJson(socket, { type: 'error', payload: 'invalid JSON' });
        return;
      }
      if (!isIncomingMessage(parsed)) {
        sendJson(socket, { type: 'error', payload: 'message must have a string "type" field' });
        return;
      }

      const handler = handlers[parsed.type];
      if (handler) {
        try {
          handler(wss, socket, parsed);
        } catch (err) {
          console.error('handler error for type', parsed.type, err);
          sendJson(socket, { type: 'error', payload: 'internal handler error' });
        }
      } else {
        sendJson(socket, { type: 'error', payload: `unknown message type: ${parsed.type}` });
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
