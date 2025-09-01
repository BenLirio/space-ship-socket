import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from '../types/messages.js';
import { broadcast, sendJson } from '../socketUtils.js';
import type { CustomWebSocket } from '../types/socket.js';
import type { ShipState } from '../types/game.js';
import { getGameState } from '../game/loop.js';

// Generation endpoint resolution order:
// 1. Explicit env GENERATE_SHIP_URL / GENERATE_SPRITE_SHEET_URL
// 2. Production default (API Gateway URL)
// 3. Dev/local default (localhost)
const PROD_DEFAULT_GENERATE_ENDPOINT =
  'https://9rc13jr0p2.execute-api.us-east-1.amazonaws.com/generate-space-ship';
const DEV_DEFAULT_GENERATE_ENDPOINT = 'http://localhost:3000/generate-space-ship';
const PROD_DEFAULT_GENERATE_SPRITE_SHEET_ENDPOINT =
  'https://9rc13jr0p2.execute-api.us-east-1.amazonaws.com/generate-sprite-sheet';
const DEV_DEFAULT_GENERATE_SPRITE_SHEET_ENDPOINT = 'http://localhost:3000/generate-sprite-sheet';
const GENERATE_ENDPOINT =
  process.env.GENERATE_SHIP_URL ||
  (process.env.NODE_ENV === 'production'
    ? PROD_DEFAULT_GENERATE_ENDPOINT
    : DEV_DEFAULT_GENERATE_ENDPOINT);
const GENERATE_SPRITE_SHEET_ENDPOINT =
  process.env.GENERATE_SPRITE_SHEET_URL ||
  (process.env.NODE_ENV === 'production'
    ? PROD_DEFAULT_GENERATE_SPRITE_SHEET_ENDPOINT
    : DEV_DEFAULT_GENERATE_SPRITE_SHEET_ENDPOINT);

interface StartWithPromptPayload {
  prompt?: unknown;
}

interface GenerateResponseOk {
  imageUrl?: string; // legacy single image URL
  sprites?: Record<string, { url?: string } | undefined>; // new multi-state response fields (may be partial)
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
  let sprites: Record<string, { url?: string }> | undefined;
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
    // New format may return a sprites object
    if (data && data.sprites && typeof data.sprites === 'object') {
      // Filter undefined values into concrete record
      const filtered: Record<string, { url?: string }> = {};
      for (const [k, v] of Object.entries(data.sprites)) {
        if (v) filtered[k] = v;
      }
      sprites = filtered;
      imageUrl =
        sprites['thrustersOfMuzzleOf']?.url ||
        sprites['trustersOfMuzzleOn']?.url ||
        Object.values(sprites).find((s) => s.url)?.url;
    } else if (data && typeof data.imageUrl === 'string' && data.imageUrl) {
      imageUrl = data.imageUrl;
    }
    if (!imageUrl) {
      return sendJson(socket, {
        type: 'error',
        payload: 'generation succeeded but missing image(s)',
      });
    }
  } catch (err) {
    console.error('[startWithPrompt] generation error', err);
    return sendJson(socket, { type: 'error', payload: 'internal generation error' });
  }

  const base: ShipState = {
    physics: { position: { x: 0, y: 0 }, rotation: 0 },
    appearance: { shipImageUrl: imageUrl },
    lastUpdatedAt: Date.now(),
  };
  if (sprites) base.sprites = sprites as Record<string, { url: string }>;
  const ship = base;
  gameState.ships[entityId] = ship;

  // Initial broadcast (may only have 1 sprite variant at this point)
  broadcast(wss, { type: 'gameState', payload: gameState });
  sendJson(socket, { type: 'info', payload: 'ship base sprite generated' });

  // Determine whether we need to expand to full sprite sheet (if we have < 4 url entries)
  const spriteUrlCount = sprites
    ? Object.values(sprites).filter((v) => v && typeof v.url === 'string' && v.url).length
    : 0;
  const primaryImageUrl = imageUrl; // for second call
  if (primaryImageUrl && spriteUrlCount < 4) {
    // Fire & forget asynchronous expansion
    (async () => {
      try {
        sendJson(socket, { type: 'info', payload: 'expanding ship sprites...' });
        const expandResp = await postJson(GENERATE_SPRITE_SHEET_ENDPOINT, {
          imageUrl: primaryImageUrl,
        });
        if (!expandResp.ok) {
          console.warn('[startWithPrompt] sprite sheet expansion failed', expandResp.status);
          return; // silent failure (base ship still usable)
        }
        const expandData = expandResp.json as GenerateResponseOk | undefined;
        if (expandData?.sprites) {
          const merged: Record<string, { url: string }> = {
            ...(ship.sprites || {}),
          } as Record<string, { url: string }>;
          for (const [k, v] of Object.entries(expandData.sprites)) {
            if (v?.url) merged[k] = { url: v.url };
          }
          ship.sprites = merged;
          if (merged['thrustersOfMuzzleOf']?.url) {
            ship.appearance.shipImageUrl = merged['thrustersOfMuzzleOf']!.url;
          }
          ship.lastUpdatedAt = Date.now();
          broadcast(wss, { type: 'gameState', payload: gameState });
          sendJson(socket, { type: 'info', payload: 'ship sprites expanded' });
        }
      } catch (err) {
        console.error('[startWithPrompt] sprite sheet expansion error', err);
      }
    })();
  }
}
