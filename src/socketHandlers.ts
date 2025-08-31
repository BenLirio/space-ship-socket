import { WebSocket } from 'ws';
import type { RawData, WebSocketServer } from 'ws';
import type { OutgoingMessage } from './app.js';

function broadcast(wss: WebSocketServer, data: OutgoingMessage, except?: WebSocket) {
  const encoded = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client !== except) {
      client.send(encoded);
    }
  }
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
      if (text === 'ping') {
        socket.send(JSON.stringify({ type: 'echo', payload: 'pong' } satisfies OutgoingMessage));
        return;
      }
      try {
        const parsed = JSON.parse(text);
        broadcast(wss, { type: 'echo', payload: parsed });
      } catch {
        broadcast(wss, { type: 'echo', payload: text });
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
