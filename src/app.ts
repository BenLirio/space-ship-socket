import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';

export interface OutgoingMessage {
  type: 'welcome' | 'echo' | 'clients' | 'error';
  payload?: unknown;
}

export interface StartedServer {
  wss: WebSocketServer;
  port: number;
  stop: () => Promise<void>;
}

export async function startServer(port: number): Promise<StartedServer> {
  const wss = new WebSocketServer({ port });

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

  await new Promise<void>((resolve) => wss.once('listening', resolve));
  const addr = wss.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  console.log(`🚀 WebSocket server listening on ws://localhost:${actualPort}`);

  wss.on('error', (err) => {
    console.error('WebSocket server error', err);
  });

  return {
    wss,
    port: actualPort,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
