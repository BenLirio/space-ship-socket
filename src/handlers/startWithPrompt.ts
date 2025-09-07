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
  const clientIp = (socket as unknown as { ip?: string }).ip;
  const ctx = clientIp ? { clientIp } : undefined;
  // First, expand the prompt
  sendJson(socket, { type: 'info', payload: 'expanding prompt…' });
  const { expandPrompt } = await import('../services/sprites.js');
  const expandedPrompt = (await expandPrompt(prompt, ctx)) || prompt;
  if (expandedPrompt !== prompt) {
    sendJson(socket, { type: 'info', payload: 'prompt expanded' });
  } else {
    sendJson(socket, { type: 'info', payload: 'using original prompt' });
  }
  // Kick off name generation in parallel; we'll attach when ready.
  const namePromise = (async () => {
    try {
      const name = await generateShipName(expandedPrompt);
      if (name) return name;
    } catch (e) {
      console.warn('[startWithPrompt] name-ship call failed', e);
    }
    return undefined;
  })();
  try {
    const resp = await postJson<GenerateResponseOk>(
      (await import('../services/endpoints.js')).GENERATE_SHIP_URL,
      { prompt: expandedPrompt },
      { headers: { 'x-client-ip': clientIp } },
    );
    if (!resp.ok)
      return sendJson(socket, {
        type: 'error',
        payload:
          (resp.json &&
            typeof resp.json === 'object' &&
            (resp.json as Record<string, unknown>).message &&
            String((resp.json as Record<string, unknown>).message)) ||
          `generation failed (status ${resp.status})`,
      });

    const { imageUrl: img, sprites: spr } = normalizeSprites(resp.json as GenerateResponseOk);
    imageUrl = img;
    sprites = spr;
    if (!imageUrl)
      return sendJson(socket, {
        type: 'error',
        payload: 'generation succeeded but missing image(s)',
      });

    // Resize base sprite(s)
    sendJson(socket, { type: 'info', payload: 'resizing base sprite(s)…' });
    resizedSprites = await resizeSprites(sprites, imageUrl, ctx).catch((err) => {
      console.warn('[startWithPrompt] resize step failed', err);
      return undefined;
    });

    // Fallback: mirror original urls if resize failed
    if (!resizedSprites && sprites) {
      const rs: PartialSprites = Object.entries(sprites).reduce((acc, [k, v]) => {
        if (v?.url) acc[k as keyof ShipSprites] = { url: v.url };
        return acc;
      }, {} as PartialSprites);
      if (Object.keys(rs).length) resizedSprites = rs;
    }
  } catch (err) {
    console.error('[startWithPrompt] generation error', err);
    return sendJson(socket, { type: 'error', payload: 'internal generation error' });
  }

  // Expand to full sprite sheet if we currently have fewer than 4 variants
  const spriteUrlCount = sprites ? Object.keys(sprites).length : 0;
  const primaryImageUrl = imageUrl;
  if (primaryImageUrl && spriteUrlCount < 4) {
    try {
      sendJson(socket, { type: 'info', payload: 'expanding ship sprites…' });
      sprites = await expandSpriteSheet(primaryImageUrl, sprites, ctx);
      if (sprites) {
        const currentResizedSet = new Set(
          resizedSprites ? Object.values(resizedSprites).map((r) => r.url) : [],
        );
        const subset: PartialSprites = Object.entries(sprites).reduce((acc, [k, v]) => {
          const u = v?.url;
          if (u && !currentResizedSet.has(u)) acc[k as keyof ShipSprites] = { url: u };
          return acc;
        }, {} as PartialSprites);
        const hasSubset = Object.keys(subset).length > 0;
        if (hasSubset) {
          sendJson(socket, { type: 'info', payload: 'resizing expanded sprites…' });
          const newlyResized = await resizeSprites(subset, undefined, ctx).catch((err) => {
            console.warn('[startWithPrompt] resize expansion step failed', err);
            return undefined;
          });
          if (newlyResized) resizedSprites = { ...(resizedSprites || {}), ...newlyResized };
        }
        sendJson(socket, { type: 'info', payload: 'sprite sheet ready' });
      }
    } catch (err) {
      console.error('[startWithPrompt] sprite sheet expansion error', err);
    }
  }

  // Ensure we have concrete structures after possible fallbacks
  resizedSprites = resizedSprites || ({} as PartialSprites);
  if (!sprites)
    sprites = Object.entries(resizedSprites).reduce((acc, [k, v]) => {
      acc[k as keyof ShipSprites] = { url: (v as { url: string }).url };
      return acc;
    }, {} as PartialSprites);

  // Compute bullet origins by diffing thrustersOnMuzzleOff vs thrustersOnMuzzleOn
  sendJson(socket, { type: 'info', payload: 'computing bullet origins…' });
  const bulletOrigins = await computeBulletOriginsFromDiff(sprites, ctx)
    .catch((err) => {
      console.warn('[startWithPrompt] diff-bounding-box step failed', err);
      return undefined;
    })
    .then((maybe) =>
      maybe && maybe.length
        ? maybe
        : [
            { x: -10, y: -30 },
            { x: 10, y: -30 },
          ],
    );
  sendJson(socket, {
    type: 'info',
    payload:
      bulletOrigins.length === 2
        ? 'bullet origins fallback applied'
        : `computed ${bulletOrigins.length} bullet origin(s)`,
  });

  // Name resolution (await with fallback)
  sendJson(socket, { type: 'info', payload: 'generating ship name…' });
  const name =
    (await namePromise) ||
    `ship ${Math.floor(Math.random() * 100000)
      .toString()
      .padStart(5, '0')}`;
  sendJson(socket, { type: 'info', payload: `ship named: ${name}` });

  // Final readiness checks
  // Finalize concrete ShipSprites ensuring all four keys exist
  const completeSprites = (
    p: Partial<Record<keyof ShipSprites, { url: string }>> | undefined,
  ): p is ShipSprites =>
    !!p &&
    !!p.thrustersOnMuzzleOn &&
    !!p.thrustersOffMuzzleOn &&
    !!p.thrustersOnMuzzleOff &&
    !!p.thrustersOffMuzzleOff;

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
