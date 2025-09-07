import type { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from '../types/messages.js';
import { broadcast, sendJson } from '../socketUtils.js';
import type { CustomWebSocket } from '../types/socket.js';
import type { ShipState, ShipSprites } from '../types/game.js';
import { getGameState } from '../game/loop.js';
import { preferredSpriteUrl } from '../game/sprites.js';
import { randomSpawn } from '../game/spawn.js';
import { postJson } from '../services/http.js';
import {
  computeBulletOriginsFromDiff,
  expandSpriteSheet,
  generateShipName,
  normalizeSprites,
  resizeSprites,
  type PartialSprites,
  type GenerateResponseOk,
} from '../services/sprites.js';

interface StartWithPromptPayload {
  prompt?: unknown;
}

// Types and low-level HTTP moved to services/

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
  let sprites: PartialSprites | undefined;
  let resizedSprites: PartialSprites | undefined;
  // Kick off name generation in parallel; we'll attach when ready.
  const namePromise = (async () => {
    try {
      const name = await generateShipName(prompt);
      if (name) return name;
    } catch (e) {
      console.warn('[startWithPrompt] name-ship call failed', e);
    }
    return undefined;
  })();
  try {
    const resp = await postJson<GenerateResponseOk>(
      // generator URL resolved in service layer
      // using endpoints.ts default resolution
      (await import('../services/endpoints.js')).GENERATE_SHIP_URL,
      { prompt },
    );
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
    const n = normalizeSprites(data);
    imageUrl = n.imageUrl;
    sprites = n.sprites;
    if (!imageUrl) {
      return sendJson(socket, {
        type: 'error',
        payload: 'generation succeeded but missing image(s)',
      });
    }

    // Always request resized versions for every url we currently have (single or multiple)
    try {
      sendJson(socket, { type: 'info', payload: 'resizing base sprite(s)…' });
      resizedSprites = await resizeSprites(sprites, imageUrl);
    } catch (err) {
      console.warn('[startWithPrompt] resize step failed', err);
    }

    // If resize failed, fall back to original URLs so downstream logic can rely on resizedSprites existing.
    if (!resizedSprites) {
      if (sprites) {
        const rs: PartialSprites = {};
        for (const [k, v] of Object.entries(sprites))
          if (v?.url)
            rs[k as keyof ShipSprites] = {
              url: v.url,
            };
        if (Object.keys(rs).length) resizedSprites = rs;
      }
    }
  } catch (err) {
    console.error('[startWithPrompt] generation error', err);
    return sendJson(socket, { type: 'error', payload: 'internal generation error' });
  }

  // Expand to full sprite sheet if we currently have fewer than 4 variants
  const spriteUrlCount = sprites ? Object.keys(sprites).length : 0;
  const primaryImageUrl = imageUrl; // for second call
  if (primaryImageUrl && spriteUrlCount < 4) {
    try {
      sendJson(socket, { type: 'info', payload: 'expanding ship sprites…' });
      sprites = await expandSpriteSheet(primaryImageUrl, sprites);
      // Resize any urls not already resized
      if (sprites) {
        try {
          const currentResizedSet = new Set(
            resizedSprites ? Object.values(resizedSprites).map((r) => r.url) : [],
          );
          const toResize = Object.values(sprites)
            .map((v) => v?.url)
            .filter((u): u is string => !!u && !currentResizedSet.has(u));
          if (toResize.length) {
            sendJson(socket, { type: 'info', payload: 'resizing expanded sprites…' });
            // reuse resizeSprites by feeding only the missing subset
            const subset: PartialSprites = {};
            for (const [k, v] of Object.entries(sprites)) {
              if (v?.url && toResize.includes(v.url))
                subset[k as keyof ShipSprites] = { url: v.url };
            }
            const newlyResized = await resizeSprites(subset);
            if (newlyResized) resizedSprites = { ...(resizedSprites || {}), ...newlyResized };
          }
        } catch (err) {
          console.warn('[startWithPrompt] resize expansion step failed', err);
        }
        sendJson(socket, { type: 'info', payload: 'sprite sheet ready' });
      }
    } catch (err) {
      console.error('[startWithPrompt] sprite sheet expansion error', err);
    }
  }

  // Ensure we have concrete structures after possible fallbacks
  resizedSprites = resizedSprites || ({} as PartialSprites);
  if (!sprites) {
    // Build sprites record from whatever we resized
    const s: PartialSprites = {};
    for (const [k, v] of Object.entries(resizedSprites))
      s[k as keyof ShipSprites] = { url: (v as { url: string }).url };
    sprites = s;
  }

  // Compute bullet origins by diffing thrustersOnMuzzleOff vs thrustersOnMuzzleOn
  sendJson(socket, { type: 'info', payload: 'computing bullet origins…' });
  let bulletOrigins: { x: number; y: number }[] = [];
  try {
    const maybe = await computeBulletOriginsFromDiff(sprites);
    if (maybe) bulletOrigins = maybe;
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
  // Finalize concrete ShipSprites ensuring all four keys exist
  function completeSprites(
    p: Partial<Record<keyof ShipSprites, { url: string }>> | undefined,
  ): p is ShipSprites {
    return (
      !!p &&
      !!p.thrustersOnMuzzleOn &&
      !!p.thrustersOffMuzzleOn &&
      !!p.thrustersOnMuzzleOff &&
      !!p.thrustersOffMuzzleOff
    );
  }

  if (!completeSprites(sprites) || !completeSprites(resizedSprites)) {
    return sendJson(socket, {
      type: 'error',
      payload: 'failed to prepare complete ship assets',
    });
  }
  const preferredUrl = preferredSpriteUrl(resizedSprites);

  // Construct the full ShipState and broadcast once
  const spawn = randomSpawn();
  const ship: ShipState = {
    physics: { position: { x: spawn.x, y: spawn.y }, rotation: spawn.rotation },
    name,
    sprites,
    resizedSprites,
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
