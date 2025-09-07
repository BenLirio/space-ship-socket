import { getJson, postJson } from './http.js';
import { SCOREBOARD_URL } from './endpoints.js';

export interface ScoreboardItem {
  id: string;
  name: string;
  score: number;
  shipImageUrl?: string;
}

export interface ScoreboardSetResponse {
  ok: boolean;
  item?: ScoreboardItem & { gsiPK?: string };
}

export interface ScoreboardListResponse {
  items: ScoreboardItem[];
  count: number;
}

export async function scoreboardSet(item: ScoreboardItem): Promise<ScoreboardSetResponse | null> {
  const resp = await postJson<ScoreboardSetResponse>(SCOREBOARD_URL, item);
  if (!resp.ok) return null;
  return resp.json ?? null;
}

export async function scoreboardList(maxItems = 25): Promise<ScoreboardListResponse | null> {
  const url = `${SCOREBOARD_URL}?maxItems=${encodeURIComponent(String(maxItems))}`;
  const resp = await getJson<ScoreboardListResponse>(url);
  if (!resp.ok) return null;
  return resp.json ?? null;
}
