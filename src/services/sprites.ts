import type { ShipSprites } from '../types/game.js';
import { preferredSpriteUrl } from '../game/sprites.js';
import {
  DIFF_BOUNDING_BOX_URL,
  GENERATE_SPRITE_SHEET_URL,
  NAME_SHIP_URL,
  RESIZE_SPRITES_URL,
} from './endpoints.js';
import { postJson } from './http.js';

export type PartialSprites = Partial<Record<keyof ShipSprites, { url: string }>>;

export interface GenerateResponseOk {
  imageUrl?: string;
  sprites?: Record<string, { url?: string } | undefined>;
  [k: string]: unknown;
}

export function normalizeSprites(data: GenerateResponseOk): {
  imageUrl?: string;
  sprites?: PartialSprites;
} {
  let imageUrl: string | undefined;
  let sprites: PartialSprites | undefined;

  if (data && data.sprites && typeof data.sprites === 'object') {
    const filtered: PartialSprites = {};
    for (const [k, v] of Object.entries(data.sprites)) {
      if (
        v?.url &&
        (k === 'thrustersOnMuzzleOn' ||
          k === 'thrustersOffMuzzleOn' ||
          k === 'thrustersOnMuzzleOff' ||
          k === 'thrustersOffMuzzleOff')
      ) {
        filtered[k as keyof ShipSprites] = { url: v.url };
      }
    }
    sprites = filtered;
    imageUrl =
      sprites.thrustersOffMuzzleOff?.url ||
      sprites.thrustersOffMuzzleOn?.url ||
      sprites.thrustersOnMuzzleOff?.url ||
      sprites.thrustersOnMuzzleOn?.url;
  } else if (data && typeof data.imageUrl === 'string' && data.imageUrl) {
    imageUrl = data.imageUrl;
  }

  const out: { imageUrl?: string; sprites?: PartialSprites } = {};
  if (imageUrl) out.imageUrl = imageUrl;
  if (sprites) out.sprites = sprites;
  return out;
}

export async function resizeSprites(
  sprites: PartialSprites | undefined,
  fallbackImageUrl?: string,
): Promise<PartialSprites | undefined> {
  const imageUrls = sprites
    ? Object.values(sprites)
        .map((s) => s.url)
        .filter((u): u is string => typeof u === 'string' && !!u)
    : fallbackImageUrl
      ? [fallbackImageUrl]
      : [];
  if (!imageUrls.length) return undefined;

  const resizeResp = await postJson<{ items?: { sourceUrl?: string; resizedUrl?: string }[] }>(
    RESIZE_SPRITES_URL,
    { imageUrls, maxWidth: 128, maxHeight: 128 },
  );
  if (!resizeResp.ok || !resizeResp.json || !Array.isArray(resizeResp.json.items)) return undefined;

  const map = new Map<string, string>();
  for (const it of resizeResp.json.items) {
    if (it?.sourceUrl && it?.resizedUrl) map.set(it.sourceUrl, it.resizedUrl);
  }

  if (sprites) {
    const rs: PartialSprites = {};
    for (const [k, v] of Object.entries(sprites)) {
      if (v?.url) {
        const resized = map.get(v.url);
        if (resized) rs[k as keyof ShipSprites] = { url: resized };
      }
    }
    return Object.keys(rs).length ? rs : undefined;
  }
  // only base provided, let expansion populate canonical keys later
  return undefined;
}

export async function expandSpriteSheet(
  primaryImageUrl: string,
  existing?: PartialSprites,
): Promise<PartialSprites | undefined> {
  const expandResp = await postJson<GenerateResponseOk>(GENERATE_SPRITE_SHEET_URL, {
    imageUrl: primaryImageUrl,
  });
  if (!expandResp.ok || !expandResp.json) return existing;
  const expandData = expandResp.json;
  if (!expandData.sprites) return existing;

  const base: PartialSprites = { ...(existing || {}) };
  for (const [k, v] of Object.entries(expandData.sprites)) {
    if (
      v?.url &&
      (k === 'thrustersOnMuzzleOn' ||
        k === 'thrustersOffMuzzleOn' ||
        k === 'thrustersOnMuzzleOff' ||
        k === 'thrustersOffMuzzleOff')
    )
      base[k as keyof ShipSprites] = { url: v.url };
  }
  return base;
}

export async function computeBulletOriginsFromDiff(
  sprites: PartialSprites,
): Promise<{ x: number; y: number }[] | undefined> {
  const muzzleOffUrl = sprites?.thrustersOnMuzzleOff?.url;
  const muzzleOnUrl = sprites?.thrustersOnMuzzleOn?.url;
  if (!muzzleOffUrl || !muzzleOnUrl) return undefined;

  const diffResp = await postJson<{
    boxes?: { x: number; y: number; width: number; height: number }[];
    imageWidth?: number;
    imageHeight?: number;
  }>(DIFF_BOUNDING_BOX_URL, {
    imageUrlA: muzzleOffUrl,
    imageUrlB: muzzleOnUrl,
    threshold: 0.03,
    minBoxArea: 500,
    minClusterPixels: 500,
  });

  if (!diffResp.ok || !diffResp.json) return undefined;
  const { boxes, imageWidth, imageHeight } = diffResp.json;
  if (!Array.isArray(boxes) || typeof imageWidth !== 'number' || typeof imageHeight !== 'number')
    return undefined;

  const fullW = imageWidth;
  const fullH = imageHeight;
  const cx = fullW / 2;
  const cy = fullH / 2;
  const TARGET_SIZE = 128;
  const scaleX = TARGET_SIZE / fullW;
  const scaleY = TARGET_SIZE / fullH;
  const CENTER_Y_EXTRA = 20;
  return boxes.map((b) => {
    const centerOx = b.x + b.width / 2 - cx;
    const centerOy = b.y + b.height / 2 - cy; // +y down
    const scaledX = centerOx * scaleX;
    const scaledY = centerOy * scaleY + CENTER_Y_EXTRA; // push downward
    return { x: scaledX, y: scaledY };
  });
}

export async function generateShipName(prompt: string): Promise<string | undefined> {
  const resp = await postJson<{ name?: string }>(NAME_SHIP_URL, { prompt });
  if (resp.ok && resp.json && typeof resp.json.name === 'string' && resp.json.name.trim()) {
    return resp.json.name.trim();
  }
  return undefined;
}

export function preferUrlFrom(s: PartialSprites): string | undefined {
  // If we happen to have a complete set, use preferred sprite choice
  const maybeComplete = s as ShipSprites;
  try {
    return preferredSpriteUrl(maybeComplete);
  } catch {
    // fallback to any available url
    for (const v of Object.values(s)) if (v?.url) return v.url;
    return undefined;
  }
}
