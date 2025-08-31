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
  const welcomePromise = waitForMessage(client, (m) => m.type === 'welcome', 4000);
  await new Promise((res, rej) => {
    client.once('open', res);
    client.once('error', rej);
  });
  await welcomePromise;

  client.send(JSON.stringify({ type: 'ping' }));
  await waitForMessage(client, (m) => m.type === 'ping');

  client.send(JSON.stringify({ hello: 'world' }));
  await waitForMessage(
    client,
    (m) =>
      m.type === 'echo' &&
      typeof m.payload === 'object' &&
      m.payload !== null &&
      (m.payload as Record<string, Json>).hello === 'world',
  );

  client.close();
  await new Promise((r) => client.once('close', r));
  await server.stop();
  console.log('Integration test success');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
