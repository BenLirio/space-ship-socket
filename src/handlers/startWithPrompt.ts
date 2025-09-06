import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from '../types/messages.js';
import { broadcast, sendJson } from '../socketUtils.js';
import type { CustomWebSocket } from '../types/socket.js';
import type { ShipState } from '../types/game.js';
import { getGameState } from '../game/loop.js';
import { preferredSpriteUrl } from '../game/sprites.js';
import { randomSpawn } from '../game/spawn.js';

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
const PROD_DEFAULT_RESIZE_ENDPOINT =
  'https://9rc13jr0p2.execute-api.us-east-1.amazonaws.com/resize';
const DEV_DEFAULT_RESIZE_ENDPOINT = 'http://localhost:3000/resize';
const PROD_DEFAULT_DIFF_BOUNDING_BOX_ENDPOINT =
  'https://9rc13jr0p2.execute-api.us-east-1.amazonaws.com/diff-bounding-box';
const DEV_DEFAULT_DIFF_BOUNDING_BOX_ENDPOINT = 'http://localhost:3000/diff-bounding-box';
const PROD_DEFAULT_NAME_SHIP_ENDPOINT =
  'https://9rc13jr0p2.execute-api.us-east-1.amazonaws.com/name-ship';
const DEV_DEFAULT_NAME_SHIP_ENDPOINT = 'http://localhost:3000/name-ship';
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
const RESIZE_ENDPOINT =
  process.env.RESIZE_SPRITES_URL ||
  (process.env.NODE_ENV === 'production'
    ? PROD_DEFAULT_RESIZE_ENDPOINT
    : DEV_DEFAULT_RESIZE_ENDPOINT);
const DIFF_BOUNDING_BOX_ENDPOINT =
  process.env.DIFF_BOUNDING_BOX_URL ||
  (process.env.NODE_ENV === 'production'
    ? PROD_DEFAULT_DIFF_BOUNDING_BOX_ENDPOINT
    : DEV_DEFAULT_DIFF_BOUNDING_BOX_ENDPOINT);
const NAME_SHIP_ENDPOINT =
  process.env.NAME_SHIP_URL ||
  (process.env.NODE_ENV === 'production'
    ? PROD_DEFAULT_NAME_SHIP_ENDPOINT
    : DEV_DEFAULT_NAME_SHIP_ENDPOINT);

interface StartWithPromptPayload {
  prompt?: unknown;
}

interface GenerateResponseOk {
  imageUrl?: string; // single image URL (older API format)
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
  sendJson(socket, { type: 'info', payload: 'generating base ship image…' });
  let imageUrl: string | undefined;
  let sprites: Record<string, { url?: string }> | undefined;
  let resizedSprites: Record<string, { url: string }> | undefined;
  // Kick off name generation in parallel; we'll attach when ready.
  const namePromise = (async () => {
    try {
      const resp = await postJson(NAME_SHIP_ENDPOINT, { prompt });
      if (resp.ok && resp.json && typeof resp.json === 'object') {
        const r = resp.json as { name?: unknown };
        if (typeof r.name === 'string' && r.name.trim()) return r.name.trim();
      }
    } catch (e) {
      console.warn('[startWithPrompt] name-ship call failed', e);
    }
    return undefined;
  })();
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
        sprites['thrustersOffMuzzleOff']?.url ||
        sprites['thrustersOffMuzzleOn']?.url ||
        sprites['thrustersOnMuzzleOff']?.url ||
        sprites['thrustersOnMuzzleOn']?.url ||
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

    // Always request resized versions for every url we currently have (single or multiple)
    try {
      const imageUrls = sprites
        ? Object.values(sprites)
            .map((s) => s.url)
            .filter((u): u is string => typeof u === 'string' && !!u)
        : [imageUrl];
      sendJson(socket, { type: 'info', payload: 'resizing base sprite(s)…' });
      const resizeResp = await postJson(RESIZE_ENDPOINT, {
        imageUrls,
        maxWidth: 128,
        maxHeight: 128,
      });
      if (resizeResp.ok && resizeResp.json && typeof resizeResp.json === 'object') {
        const rr = resizeResp.json as { items?: { sourceUrl?: string; resizedUrl?: string }[] };
        if (Array.isArray(rr.items)) {
          const map = new Map<string, string>();
          for (const it of rr.items) {
            if (it?.sourceUrl && it?.resizedUrl) map.set(it.sourceUrl, it.resizedUrl);
          }
          if (sprites) {
            const rs: Record<string, { url: string }> = {};
            for (const [k, v] of Object.entries(sprites)) {
              if (v?.url) {
                const resized = map.get(v.url);
                if (resized) rs[k] = { url: resized };
              }
            }
            resizedSprites = rs;
          } else if (imageUrl) {
            const resized = map.get(imageUrl);
            if (resized) {
              resizedSprites = { base: { url: resized } };
            }
          }
        }
      }
    } catch (err) {
      console.warn('[startWithPrompt] resize step failed', err);
    }

    // If resize failed, fall back to original URLs so downstream logic can rely on resizedSprites existing.
    if (!resizedSprites) {
      if (sprites) {
        const rs: Record<string, { url: string }> = {};
        for (const [k, v] of Object.entries(sprites)) if (v?.url) rs[k] = { url: v.url };
        if (Object.keys(rs).length) resizedSprites = rs;
      } else if (imageUrl) {
        resizedSprites = { base: { url: imageUrl } };
      }
    }
  } catch (err) {
    console.error('[startWithPrompt] generation error', err);
    return sendJson(socket, { type: 'error', payload: 'internal generation error' });
  }

  // Expand to full sprite sheet if we currently have fewer than 4 variants
  const spriteUrlCount = sprites
    ? Object.values(sprites).filter((v) => v && typeof v.url === 'string' && v.url).length
    : 0;
  const primaryImageUrl = imageUrl; // for second call
  if (primaryImageUrl && spriteUrlCount < 4) {
    try {
      sendJson(socket, { type: 'info', payload: 'expanding ship sprites…' });
      const expandResp = await postJson(GENERATE_SPRITE_SHEET_ENDPOINT, {
        imageUrl: primaryImageUrl,
      });
      if (!expandResp.ok) {
        console.warn('[startWithPrompt] sprite sheet expansion failed', expandResp.status);
      } else {
        const expandData = expandResp.json as GenerateResponseOk | undefined;
        if (expandData?.sprites) {
          const base: Record<string, { url: string }> = {};
          if (sprites) {
            for (const [k, v] of Object.entries(sprites)) if (v?.url) base[k] = { url: v.url };
          }
          for (const [k, v] of Object.entries(expandData.sprites)) {
            if (v?.url) base[k] = { url: v.url };
          }
          sprites = base;
          // Resize any urls not already resized
          try {
            const toResize = Object.values(base)
              .map((v) => v.url)
              .filter(
                (u) =>
                  u &&
                  (!resizedSprites || !Object.values(resizedSprites).some((rv) => rv.url === u)),
              );
            if (toResize.length) {
              sendJson(socket, { type: 'info', payload: 'resizing expanded sprites…' });
              const resizeResp2 = await postJson(RESIZE_ENDPOINT, {
                imageUrls: toResize,
                maxWidth: 128,
                maxHeight: 128,
              });
              if (resizeResp2.ok && resizeResp2.json && typeof resizeResp2.json === 'object') {
                const rr2 = resizeResp2.json as {
                  items?: { sourceUrl?: string; resizedUrl?: string }[];
                };
                if (Array.isArray(rr2.items)) {
                  resizedSprites = resizedSprites || ({} as Record<string, { url: string }>);
                  const lookup = new Map<string, string>();
                  for (const it of rr2.items) {
                    if (it?.sourceUrl && it?.resizedUrl) lookup.set(it.sourceUrl, it.resizedUrl);
                  }
                  for (const [k, v] of Object.entries(base)) {
                    const rz = lookup.get(v.url);
                    if (rz) resizedSprites[k] = { url: rz };
                  }
                }
              }
            }
          } catch (err) {
            console.warn('[startWithPrompt] resize expansion step failed', err);
          }
          sendJson(socket, { type: 'info', payload: 'sprite sheet ready' });
        }
      }
    } catch (err) {
      console.error('[startWithPrompt] sprite sheet expansion error', err);
    }
  }

  // Ensure we have concrete structures after possible fallbacks
  resizedSprites = resizedSprites || ({} as Record<string, { url: string }>);
  if (!sprites) {
    // Build sprites record from whatever we resized
    const s: Record<string, { url: string }> = {};
    for (const [k, v] of Object.entries(resizedSprites)) s[k] = { url: v.url };
    sprites = s;
  }

  // Compute bullet origins by diffing thrustersOnMuzzleOff vs thrustersOnMuzzleOn
  sendJson(socket, { type: 'info', payload: 'computing bullet origins…' });
  let bulletOrigins: { x: number; y: number }[] = [];
  try {
    const muzzleOffUrl = sprites?.['thrustersOnMuzzleOff']?.url;
    const muzzleOnUrl = sprites?.['thrustersOnMuzzleOn']?.url;
    if (muzzleOffUrl && muzzleOnUrl) {
      const diffResp = await postJson(DIFF_BOUNDING_BOX_ENDPOINT, {
        imageUrlA: muzzleOffUrl,
        imageUrlB: muzzleOnUrl,
        threshold: 0.03,
        minBoxArea: 500,
        minClusterPixels: 500,
      });
      if (diffResp.ok && diffResp.json && typeof diffResp.json === 'object') {
        const diffJson = diffResp.json as {
          boxes?: { x: number; y: number; width: number; height: number }[];
          imageWidth?: number;
          imageHeight?: number;
        };
        if (
          Array.isArray(diffJson.boxes) &&
          typeof diffJson.imageWidth === 'number' &&
          typeof diffJson.imageHeight === 'number'
        ) {
          const fullW = diffJson.imageWidth;
          const fullH = diffJson.imageHeight;
          const cx = fullW / 2;
          const cy = fullH / 2;
          const TARGET_SIZE = 128;
          const scaleX = TARGET_SIZE / fullW;
          const scaleY = TARGET_SIZE / fullH;
          const CENTER_Y_EXTRA = 20;
          bulletOrigins = diffJson.boxes.map((b) => {
            const centerOx = b.x + b.width / 2 - cx;
            const centerOy = b.y + b.height / 2 - cy; // +y down
            const scaledX = centerOx * scaleX;
            const scaledY = centerOy * scaleY + CENTER_Y_EXTRA; // push downward
            return { x: scaledX, y: scaledY };
          });
        }
      }
    }
  } catch (err) {
    console.warn('[startWithPrompt] diff-bounding-box step failed', err);
  }

  if (!bulletOrigins.length) {
    // Fallback twin guns
    bulletOrigins = [
      { x: -10, y: -30 },
      { x: 10, y: -30 },
    ];
    sendJson(socket, {
      type: 'info',
      payload: 'bullet origins fallback applied',
    });
  } else {
    sendJson(socket, {
      type: 'info',
      payload: `computed ${bulletOrigins.length} bullet origin(s)`,
    });
  }

  // Name resolution (await with fallback)
  sendJson(socket, { type: 'info', payload: 'generating ship name…' });
  let name = await namePromise;
  if (!name) {
    name = `ship ${Math.floor(Math.random() * 100000)
      .toString()
      .padStart(5, '0')}`;
    sendJson(socket, { type: 'info', payload: `name service unavailable, using: ${name}` });
  } else {
    sendJson(socket, { type: 'info', payload: `ship named: ${name}` });
  }

  // Final readiness checks
  const preferredUrl = preferredSpriteUrl(resizedSprites) || imageUrl;
  if (
    !preferredUrl ||
    !sprites ||
    !Object.keys(sprites).length ||
    !resizedSprites ||
    !Object.keys(resizedSprites).length
  ) {
    return sendJson(socket, {
      type: 'error',
      payload: 'failed to prepare complete ship assets',
    });
  }

  // Construct the full ShipState and broadcast once
  const spawn = randomSpawn();
  const ship: ShipState = {
    physics: { position: { x: spawn.x, y: spawn.y }, rotation: spawn.rotation },
    name,
    sprites: sprites as Record<string, { url: string }>,
    resizedSprites: resizedSprites as Record<string, { url: string }>,
    health: 100,
    kills: 0,
    bulletOrigins,
    appearance: { shipImageUrl: preferredUrl },
    lastUpdatedAt: Date.now(),
  };

  gameState.ships[entityId] = ship;
  broadcast(wss, { type: 'gameState', payload: gameState });
  sendJson(socket, { type: 'info', payload: 'ship ready' });
}
