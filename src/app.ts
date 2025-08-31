import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import fs from 'fs';
import https from 'https';

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
  // Optional TLS (wss) support: if cert & key exist (or explicitly configured via env),
  // we create an HTTPS server and attach WebSocketServer to it. Otherwise fall back to plain ws.
  const certPath = process.env.TLS_CERT_PATH || '/etc/space-ship-socket/certs/fullchain.pem';
  const keyPath = process.env.TLS_KEY_PATH || '/etc/space-ship-socket/certs/privkey.pem';
  let server: https.Server | undefined;
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const cert = fs.readFileSync(certPath);
    const key = fs.readFileSync(keyPath);
    server = https.createServer({ cert, key });
  }

  const wss = server ? new WebSocketServer({ server }) : new WebSocketServer({ port });

  function broadcast(data: OutgoingMessage, except?: WebSocket) {
    const encoded = JSON.stringify(data);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN && client !== except) {
        client.send(encoded);
      }
    }
  }

  wss.on('connection', (socket: WebSocket) => {
    console.log(`New client connected`);
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

  await new Promise<void>((resolve) => (server ? server : wss).once('listening', resolve));

  // address retrieval differs if we used underlying server
  const addr = (server || wss).address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const scheme = server ? 'wss' : 'ws';
  console.log(`🚀 WebSocket server listening on ${scheme}://0.0.0.0:${actualPort}`);

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
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close((err) => (err ? reject(err) : resolve()));
        });
      }
    },
  };
}
