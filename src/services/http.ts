// Tiny HTTP helpers built on global fetch (Node 18+)

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; json: T | undefined }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: T | undefined = undefined;
  try {
    data = (await res.json()) as T;
  } catch {
    // ignore parse failures
  }
  return { ok: res.ok, status: res.status, json: data };
}

export async function getJson<T = unknown>(
  url: string,
): Promise<{ ok: boolean; status: number; json: T | undefined }> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  let data: T | undefined = undefined;
  try {
    data = (await res.json()) as T;
  } catch {
    // ignore parse failures
  }
  return { ok: res.ok, status: res.status, json: data };
}
