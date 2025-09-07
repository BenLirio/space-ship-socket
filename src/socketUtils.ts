import { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { OutgoingMessage } from './types/messages.js';

export function sendJson(socket: WebSocket, msg: OutgoingMessage) {
  socket.send(JSON.stringify(msg));
}

export function broadcast(wss: WebSocketServer, data: OutgoingMessage, except?: WebSocket) {
  const encoded = JSON.stringify(data);
  Array.from(wss.clients)
    .filter((c) => c.readyState === WebSocket.OPEN && c !== except)
    .forEach((c) => c.send(encoded));
}
