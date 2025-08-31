import { WebSocketServer } from 'ws';
import fs from 'fs';
import https from 'https';
import { attachSocketHandlers } from './socketHandlers.js';
import type { StartedServer } from './types/server.js';

export async function startServer(port: number): Promise<StartedServer> {
  // Optional TLS (wss) support: if cert & key exist (or explicitly configured via env),
  // we create an HTTPS server and attach WebSocketServer to it. Otherwise fall back to plain ws.
  const certPath = process.env.TLS_CERT_PATH || '/etc/space-ship-socket/certs/fullchain.pem';
  const keyPath = process.env.TLS_KEY_PATH || '/etc/space-ship-socket/certs/privkey.pem';
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

  const wss = server ? new WebSocketServer({ server }) : new WebSocketServer({ port });
  attachSocketHandlers(wss);

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
