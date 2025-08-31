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
  // TLS (wss) support: if cert & key exist (or explicitly configured via env),
  // we create an HTTPS server and attach WebSocketServer to it. Otherwise fall back to plain ws
  // UNLESS either REQUIRE_TLS=1 is set or we're binding to port 443 (common implicit expectation of TLS).
  const certPath = process.env.TLS_CERT_PATH || '/etc/space-ship-socket/certs/fullchain.pem';
  const keyPath = process.env.TLS_KEY_PATH || '/etc/space-ship-socket/certs/privkey.pem';
  const requireTls = process.env.REQUIRE_TLS === '1' || port === 443;
  let server: https.Server | undefined;
  let usingTls = false;
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const cert = fs.readFileSync(certPath);
      const key = fs.readFileSync(keyPath);
      server = https.createServer({ cert, key });
      usingTls = true;
    } catch (err) {
      console.warn('[startup] Found TLS cert/key but failed to read, continuing without TLS', err);
    }
  }
  if (!server && requireTls) {
    const reason = `TLS required (REQUIRE_TLS=${process.env.REQUIRE_TLS || '0'}; port=${port}) but certificate/key not present at ${certPath} / ${keyPath}`;
    console.error('[startup] FATAL:', reason);
    throw new Error(reason);
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

  if (server) {
    server.listen(port);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
  } else {
    await new Promise<void>((resolve) => wss.once('listening', resolve));
  }

  // address retrieval differs if we used underlying server
  const addr = (server || wss).address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const scheme = usingTls ? 'wss' : 'ws';
  console.log(`🚀 WebSocket server listening on ${scheme}://0.0.0.0:${actualPort}`);
  if (!usingTls) {
    console.log(
      '[info] TLS not enabled (cert/key not found). To enable wss, provide cert at',
      certPath,
      'and key at',
      keyPath,
    );
    if (requireTls) {
      console.warn(
        '[warning] TLS was required but server started without it (this should not happen)',
      );
    } else if (actualPort === 443) {
      console.warn(
        '[warning] Listening on privileged port 443 WITHOUT TLS – consider adding certificates or setting a different port',
      );
    }
  }

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
