import type { InternalLoopState } from './game/types.js';
import type { WebSocket, WebSocketServer } from 'ws';
import { broadcast, sendJson } from './socketUtils.js';

interface ScoreboardItem {
  id: string;
  name: string;
  score: number;
  shipImageUrl: string;
  createdAt?: string;
}

interface ListResponse {
  items: ScoreboardItem[];
}

const BASE_URL = process.env.SCOREBOARD_BASE_URL || 'http://localhost:3000';
const ENDPOINT = `${BASE_URL.replace(/\/$/, '')}/scoreboard`;

async function postJson(url: string, body: unknown): Promise<void> {
  if (typeof fetch !== 'function') {
    // Runtime without fetch (very old Node). Silently no-op.
    return;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // Keep requests snappy; don't block sim loop.
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      // Swallow to avoid crashing server; log once per failure site
      console.warn('[scoreboard] POST failed', res.status);
    }
  } catch {
    // Service might be down; ignore
    // console.debug('[scoreboard] POST error', err);
  }
}

async function getJson<T>(url: string): Promise<T | undefined> {
  if (typeof fetch !== 'function') return undefined;
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(1500) });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

export async function updateAndBroadcastScore(
  loop: InternalLoopState,
  wss: WebSocketServer,
  playerId: string,
) {
  // Collect current player state; if missing, bail.
  const ship = loop.gameState.ships[playerId];
  if (!ship) return;
  const name = ship.name || playerId;
  const shipImageUrl =
    ship.resizedSprites?.thrustersOnMuzzleOff?.url ||
    ship.sprites?.thrustersOnMuzzleOff?.url ||
    ship.appearance.shipImageUrl;

  const payload: ScoreboardItem = {
    id: playerId,
    name,
    score: ship.kills ?? 0,
    shipImageUrl,
  };

  // Fire-and-forget to keep the sim responsive
  await postJson(ENDPOINT, payload);
  const list = await getJson<ListResponse>(ENDPOINT);
  if (list) {
    broadcast(wss, { type: 'scoreboard', payload: list });
  }
}

export async function sendLatestScoreboardTo(socket: WebSocket) {
  const list = await getJson<ListResponse>(ENDPOINT);
  if (list) {
    sendJson(socket, { type: 'scoreboard', payload: list });
  }
}
