import { startServer } from '../../src/app.js';
import { WebSocket } from 'ws';

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];
interface GenericMessage {
  type?: string;
  payload?: Json;
  [k: string]: unknown;
}

function waitForMessage(
  ws: WebSocket,
  predicate: (data: GenericMessage) => boolean,
  timeoutMs = 2000,
): Promise<GenericMessage> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
    ws.on('message', (raw) => {
      let parsed: GenericMessage;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        parsed = { type: 'raw', payload: raw.toString() };
      }
      if (predicate(parsed)) {
        clearTimeout(to);
        resolve(parsed);
      }
    });
  });
}

async function run() {
  const server = await startServer(0); // ephemeral port
  const port = server.port;

  const client = new WebSocket(`ws://localhost:${port}`);
  await new Promise((res, rej) => {
    client.once('open', res);
    client.once('error', rej);
  });

  client.send(JSON.stringify({ type: 'ping' }));
  await waitForMessage(client, (m) => m.type === 'ping');
  // Ask server to echo connection info if available in future; for now, we just ensure the connection works.
  client.close();
  await new Promise((r) => client.once('close', r));
  await server.stop();
  // Print GREEN SUCCESS
  console.log('\x1b[32mSUCCESS\x1b[0m');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
