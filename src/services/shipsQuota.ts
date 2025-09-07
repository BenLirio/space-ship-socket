import { GET_NUM_REMAINING_SHIPS_URL } from './endpoints.js';
import { getJson } from './http.js';

export interface RemainingShipsResponse {
  ip: string;
  remaining: number;
  cap: number;
}

export async function getRemainingShips(ctx?: {
  clientIp?: string;
}): Promise<RemainingShipsResponse | null> {
  const resp = await getJson<RemainingShipsResponse>(GET_NUM_REMAINING_SHIPS_URL, {
    headers: { 'x-client-ip': ctx?.clientIp },
  });
  if (!resp.ok) return null;
  return resp.json ?? null;
}
