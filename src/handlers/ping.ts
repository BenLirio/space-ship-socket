import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { OutgoingMessage, IncomingMessage } from '../app.js';
import { sendJson } from '../socketUtils.js';

export type PingMessage = IncomingMessage & { type: 'ping' };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function handlePing(_wss: WebSocketServer, socket: WebSocket, _msg: IncomingMessage) {
  const resp: OutgoingMessage = { type: 'ping' };
  sendJson(socket, resp);
}
