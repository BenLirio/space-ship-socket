import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { OutgoingMessage, IncomingMessage } from '../types/messages.js';
import { sendJson } from '../socketUtils.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function handlePing(_wss: WebSocketServer, socket: WebSocket, _msg: IncomingMessage) {
  const resp: OutgoingMessage = { type: 'ping' };
  sendJson(socket, resp);
}
