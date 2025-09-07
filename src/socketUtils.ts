import { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { OutgoingMessage } from './types/messages.js';
import type { IncomingMessage as NodeIncomingMessage } from 'http';

export function sendJson(socket: WebSocket, msg: OutgoingMessage) {
  socket.send(JSON.stringify(msg));
}

export function broadcast(wss: WebSocketServer, data: OutgoingMessage, except?: WebSocket) {
  const encoded = JSON.stringify(data);
  Array.from(wss.clients)
    .filter((c) => c.readyState === WebSocket.OPEN && c !== except)
    .forEach((c) => c.send(encoded));
}

/**
 * Extract a client IP address from an HTTP upgrade request.
 * - Prefers the first IP from X-Forwarded-For if present
 * - Falls back to X-Real-IP
 * - Otherwise uses req.socket.remoteAddress
 * - Normalizes ::ffff:127.0.0.1 -> 127.0.0.1 and ::1 -> 127.0.0.1
 */
export function clientIpFromRequest(req: NodeIncomingMessage): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  const fromXff = Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim();
  const real = req.headers['x-real-ip'];
  const remote = req.socket?.remoteAddress;
  const ipRaw = (fromXff || (Array.isArray(real) ? real[0] : (real as string)) || remote || '')
    .toString()
    .trim()
    .replace(/^::ffff:/, '');
  if (!ipRaw) return undefined;
  if (ipRaw === '::1') return '127.0.0.1';
  return ipRaw;
}
