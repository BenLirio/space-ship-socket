import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from '../types/messages.js';
import { broadcast, sendJson } from '../socketUtils.js';
import type { CustomWebSocket } from '../types/socket.js';
import type { ShipState } from '../types/game.js';
import { getGameState } from '../gameLoop.js';

// Generation endpoint resolution order:
// 1. Explicit env GENERATE_SHIP_URL
// 2. Production default (API Gateway URL)
// 3. Dev/local default (localhost)
const PROD_DEFAULT_GENERATE_ENDPOINT =
  'https://9rc13jr0p2.execute-api.us-east-1.amazonaws.com/generate-space-ship';
const DEV_DEFAULT_GENERATE_ENDPOINT = 'http://localhost:3000/generate-space-ship';
const GENERATE_ENDPOINT =
  process.env.GENERATE_SHIP_URL ||
  (process.env.NODE_ENV === 'production'
    ? PROD_DEFAULT_GENERATE_ENDPOINT
    : DEV_DEFAULT_GENERATE_ENDPOINT);

interface StartWithPromptPayload {
  prompt?: unknown;
}

interface GenerateResponseOk {
  imageUrl?: string;
  [k: string]: unknown;
}

/** Simple JSON POST helper using global fetch (Node 18+) */
async function postJson(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* ignore parse errors; data stays null */
  }
  return { ok: res.ok, status: res.status, json: data };
}

export async function handleStartWithPrompt(
  wss: WebSocketServer,
  socket: WebSocket,
  msg: IncomingMessage,
) {
  const gameState = getGameState();
  if (!gameState) return; // defensive

  const payload = (msg as { payload?: unknown }).payload as StartWithPromptPayload | undefined;
  const rawPrompt = payload?.prompt;
  const prompt = typeof rawPrompt === 'string' && rawPrompt.trim() ? rawPrompt.trim() : undefined;
  if (!prompt) {
    return sendJson(socket, { type: 'error', payload: 'prompt must be a non-empty string' });
  }

  const entityId = (socket as CustomWebSocket).id;
  sendJson(socket, { type: 'info', payload: 'generating ship...' });
  let imageUrl: string | undefined;
  try {
    const resp = await postJson(GENERATE_ENDPOINT, { prompt });
    if (!resp.ok) {
      let msgStr = `generation failed (status ${resp.status})`;
      if (resp.json && typeof resp.json === 'object') {
        const maybe = resp.json as Record<string, unknown>;
        if (typeof maybe.message === 'string' && maybe.message.trim()) {
          msgStr = maybe.message;
        }
      }
      return sendJson(socket, { type: 'error', payload: msgStr });
    }
    const data = resp.json as GenerateResponseOk;
    if (!data || typeof data.imageUrl !== 'string' || !data.imageUrl) {
      return sendJson(socket, { type: 'error', payload: 'generation succeeded but no imageUrl' });
    }
    imageUrl = data.imageUrl;
  } catch (err) {
    console.error('[startWithPrompt] generation error', err);
    return sendJson(socket, { type: 'error', payload: 'internal generation error' });
  }

  const ship: ShipState = {
    physics: { position: { x: 0, y: 0 }, rotation: 0 },
    appearance: { shipImageUrl: imageUrl },
    lastUpdatedAt: Date.now(),
  };
  gameState.ships[entityId] = ship;

  broadcast(wss, { type: 'gameState', payload: gameState });
  sendJson(socket, { type: 'info', payload: 'ship generated' });
}
