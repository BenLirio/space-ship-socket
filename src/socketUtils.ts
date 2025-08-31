import { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { OutgoingMessage } from './app.js';

export function sendJson(socket: WebSocket, msg: OutgoingMessage) {
  socket.send(JSON.stringify(msg));
}

export function broadcast(wss: WebSocketServer, data: OutgoingMessage, except?: WebSocket) {
  const encoded = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client !== except) {
      client.send(encoded);
    }
  }
}
