import type { WebSocket } from 'ws';
import type { RawData, WebSocketServer } from 'ws';
import type { OutgoingMessage, IncomingMessage } from './app.js';
import { broadcast, sendJson } from './socketUtils.js';
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
    socket.send(
      JSON.stringify({
        type: 'welcome',
        payload: { message: 'Connected to space-ship-socket server' },
      } satisfies OutgoingMessage),
    );

    broadcast(wss, { type: 'clients', payload: { count: wss.clients.size } });

    socket.on('message', (data: RawData) => {
      const text = data.toString();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON payload: just echo as before
        broadcast(wss, { type: 'echo', payload: text });
        return;
      }

      if (isIncomingMessage(parsed)) {
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
      } else if (typeof parsed === 'object' && parsed !== null) {
        // Back-compat: object without type -> echo
        broadcast(wss, { type: 'echo', payload: parsed });
      } else {
        broadcast(wss, { type: 'echo', payload: parsed });
      }
    });

    socket.on('close', () => {
      broadcast(wss, { type: 'clients', payload: { count: wss.clients.size } });
    });
  });

  wss.on('error', (err) => {
    console.error('WebSocket server error', err);
  });
}
