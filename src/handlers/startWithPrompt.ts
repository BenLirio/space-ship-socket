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
const PROD_DEFAULT_RESIZE_ENDPOINT =
  'https://9rc13jr0p2.execute-api.us-east-1.amazonaws.com/resize';
const DEV_DEFAULT_RESIZE_ENDPOINT = 'http://localhost:3000/resize';
const PROD_DEFAULT_DIFF_BOUNDING_BOX_ENDPOINT =
  'https://9rc13jr0p2.execute-api.us-east-1.amazonaws.com/diff-bounding-box';
const DEV_DEFAULT_DIFF_BOUNDING_BOX_ENDPOINT = 'http://localhost:3000/diff-bounding-box';
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
  let resizedSprites: Record<string, { url: string }> | undefined;
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

    // If resize failed produce a synthetic resizedSprites mapping pointing at originals so downstream logic
    // (which always reads resizedSprites) still functions and never falls back to full-size lookup logic.
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

  // At this point resizedSprites is guaranteed defined (fallback applied above)
  resizedSprites = resizedSprites || ({} as Record<string, { url: string }>);
  const { SPAWN_RANGE } = await import('../game/constants.js');
  const spawnX = (Math.random() * 2 - 1) * SPAWN_RANGE;
  const spawnY = (Math.random() * 2 - 1) * SPAWN_RANGE;
  const spawnRot = (Math.random() * 2 - 1) * Math.PI;
  const base: ShipState = {
    physics: { position: { x: spawnX, y: spawnY }, rotation: spawnRot },
    health: 100,
    kills: 0,
    appearance: {
      shipImageUrl:
        resizedSprites['thrustersOffMuzzleOff']?.url ||
        resizedSprites['thrustersOffMuzzleOn']?.url ||
        resizedSprites['thrustersOnMuzzleOff']?.url ||
        resizedSprites['thrustersOnMuzzleOn']?.url ||
        Object.values(resizedSprites)[0]?.url ||
        imageUrl,
    },
    lastUpdatedAt: Date.now(),
  };
  if (sprites) base.sprites = sprites as Record<string, { url: string }>;
  if (resizedSprites) base.resizedSprites = resizedSprites as Record<string, { url: string }>;
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
          // Attempt to resize any new sprite urls
          try {
            const newUrls = Object.values(merged)
              .map((v) => v.url)
              .filter(
                (u) =>
                  u &&
                  (!ship.resizedSprites ||
                    !Object.values(ship.resizedSprites).some((rv) => rv && rv.url === u)),
              );
            if (newUrls.length) {
              const resizeResp2 = await postJson(RESIZE_ENDPOINT, {
                imageUrls: newUrls,
                maxWidth: 128,
                maxHeight: 128,
              });
              if (resizeResp2.ok && resizeResp2.json && typeof resizeResp2.json === 'object') {
                const rr2 = resizeResp2.json as {
                  items?: { sourceUrl?: string; resizedUrl?: string }[];
                };
                if (Array.isArray(rr2.items)) {
                  ship.resizedSprites =
                    ship.resizedSprites || ({} as Record<string, { url: string }>);
                  const lookup = new Map<string, string>();
                  for (const it of rr2.items) {
                    if (it?.sourceUrl && it?.resizedUrl) lookup.set(it.sourceUrl, it.resizedUrl);
                  }
                  for (const [k, v] of Object.entries(merged)) {
                    const rz = lookup.get(v.url);
                    if (rz) ship.resizedSprites[k] = { url: rz };
                  }
                }
              }
            }
          } catch (err) {
            console.warn('[startWithPrompt] resize expansion step failed', err);
          }
          // Prefer canonical idle resized variant (else the first resized)
          if (ship.resizedSprites) {
            const preferred =
              ship.resizedSprites['thrustersOffMuzzleOff']?.url ||
              ship.resizedSprites['thrustersOffMuzzleOn']?.url ||
              ship.resizedSprites['thrustersOnMuzzleOff']?.url ||
              ship.resizedSprites['thrustersOnMuzzleOn']?.url ||
              Object.values(ship.resizedSprites)[0]?.url;
            if (preferred) ship.appearance.shipImageUrl = preferred;
          }
          ship.lastUpdatedAt = Date.now();
          broadcast(wss, { type: 'gameState', payload: gameState });
          sendJson(socket, { type: 'info', payload: 'ship sprites expanded' });

          // Attempt to compute bullet origins by diffing thrustersOnMuzzleOff vs thrustersOnMuzzleOn (FULL size, not resized)
          try {
            const muzzleOffUrl = ship.sprites?.['thrustersOnMuzzleOff']?.url;
            const muzzleOnUrl = ship.sprites?.['thrustersOnMuzzleOn']?.url;
            if (muzzleOffUrl && muzzleOnUrl) {
              const diffResp = await postJson(DIFF_BOUNDING_BOX_ENDPOINT, {
                imageUrlA: muzzleOffUrl,
                imageUrlB: muzzleOnUrl,
                // Tuned parameters: tighter threshold & large box/pixel minimum to isolate muzzle flashes
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
                  // Target displayed size (matches resize service request max 128). If actual resized differs
                  // (non-square), we could optionally look it up; for now assume square scaling w.r.t original.
                  const TARGET_SIZE = 128; // matches resize request maxWidth/maxHeight
                  const scaleX = TARGET_SIZE / fullW;
                  const scaleY = TARGET_SIZE / fullH;
                  // Compute ORIGINS using geometric CENTER of each bounding box, then apply a fixed
                  // downward ( +y ) offset so bullets originate slightly behind the brightest part of
                  // the muzzle flash (closer to the barrel). Tunable constant below.
                  const CENTER_Y_EXTRA = 20; // pixels in resized 128x128 local space (was 15; +10px per request)
                  const scaledOrigins = diffJson.boxes.map((b) => {
                    const centerOx = b.x + b.width / 2 - cx;
                    const centerOy = b.y + b.height / 2 - cy; // +y down
                    const scaledX = centerOx * scaleX;
                    const scaledY = centerOy * scaleY + CENTER_Y_EXTRA; // push downward
                    return { x: scaledX, y: scaledY };
                  });
                  if (scaledOrigins.length) {
                    ship.bulletOrigins = scaledOrigins;
                    ship.lastUpdatedAt = Date.now();
                    broadcast(wss, { type: 'gameState', payload: gameState });
                    sendJson(socket, {
                      type: 'info',
                      payload: `computed ${scaledOrigins.length} bullet origin(s)`,
                    });
                  }
                }
              }
            }
          } catch (err) {
            console.warn('[startWithPrompt] diff-bounding-box step failed', err);
          }
        }
      } catch (err) {
        console.error('[startWithPrompt] sprite sheet expansion error', err);
      }
    })();
  }
}
