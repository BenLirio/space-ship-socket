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
  const server = await startServer(0);
  const port = server.port;
  const client = new WebSocket(`ws://localhost:${port}`);
  await new Promise((res, rej) => {
    client.once('open', res);
    client.once('error', rej);
  });

  // Wait for connected message to get id
  const connected = await waitForMessage(client, (m) => m.type === 'connected');
  const id =
    typeof connected.payload === 'object' && connected.payload && 'id' in connected.payload
      ? (connected.payload as { id: string }).id
      : undefined;
  if (!id) throw new Error('no id in connected message');

  const shipStateMsg = {
    type: 'shipState',
    payload: {
      physics: { position: { x: 387, y: 720 }, rotation: 0 },
      appearance: {
        shipImageUrl:
          'https://space-ship-sprites.s3.amazonaws.com/generated/fa760a12-89cb-40c7-bd85-cfe22bfc5874.png',
      },
    },
  };
  client.send(JSON.stringify(shipStateMsg));

  // Expect a gameState broadcast that includes our ship
  await waitForMessage(
    client,
    (m) => {
      if (m.type !== 'gameState') return false;
      if (typeof m.payload !== 'object' || m.payload === null) return false;
      const payload = m.payload as { ships?: Record<string, unknown> };
      if (!payload.ships) return false;
      const ship = payload.ships[id] as
        | { appearance?: { shipImageUrl?: string }; physics?: unknown }
        | undefined;
      return (
        !!ship &&
        !!ship.appearance &&
        ship.appearance.shipImageUrl === shipStateMsg.payload.appearance.shipImageUrl
      );
    },
    3000,
  );

  client.close();
  await new Promise((r) => client.once('close', r));
  await server.stop();
  console.log('\x1b[32mSHIP_STATE_SUCCESS\x1b[0m');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
