import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';

const PORT = Number(process.env.PORT) || 8080;

interface OutgoingMessage {
  type: 'welcome' | 'echo' | 'clients' | 'error';
  payload?: unknown;
}

const wss = new WebSocketServer({ port: PORT });

function broadcast(data: OutgoingMessage, except?: WebSocket) {
  const encoded = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client !== except) {
      client.send(encoded);
    }
  }
}

wss.on('connection', (socket: WebSocket) => {
  socket.send(
    JSON.stringify({
      type: 'welcome',
      payload: { message: 'Connected to space-ship-socket server' },
    } satisfies OutgoingMessage),
  );

  broadcast({ type: 'clients', payload: { count: wss.clients.size } });

  socket.on('message', (data: RawData) => {
    const text = data.toString();
    if (text === 'ping') {
      socket.send(JSON.stringify({ type: 'echo', payload: 'pong' } satisfies OutgoingMessage));
      return;
    }
    try {
      const parsed = JSON.parse(text);
      broadcast({ type: 'echo', payload: parsed });
    } catch {
      broadcast({ type: 'echo', payload: text });
    }
  });

  socket.on('close', () => {
    broadcast({ type: 'clients', payload: { count: wss.clients.size } });
  });
});

wss.on('listening', () => {
  console.log(`🚀 WebSocket server listening on ws://localhost:${PORT}`);
});

wss.on('error', (err) => {
  console.error('WebSocket server error', err);
});

export {}; // ensure this file is treated as a module
