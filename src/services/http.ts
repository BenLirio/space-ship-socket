// Tiny HTTP helpers built on global fetch (Node 18+)

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  opts?: { headers?: Record<string, string | undefined> },
): Promise<{ ok: boolean; status: number; json: T | undefined }> {
  const extra = opts?.headers
    ? Object.fromEntries(
        Object.entries(opts.headers).filter(([, v]) => typeof v === 'string' && !!v),
      )
    : undefined;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(extra || {}) },
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
  opts?: { headers?: Record<string, string | undefined> },
): Promise<{ ok: boolean; status: number; json: T | undefined }> {
  const extra = opts?.headers
    ? Object.fromEntries(
        Object.entries(opts.headers).filter(([, v]) => typeof v === 'string' && !!v),
      )
    : undefined;
  const res = await fetch(url, { headers: { Accept: 'application/json', ...(extra || {}) } });
  let data: T | undefined = undefined;
  try {
    data = (await res.json()) as T;
  } catch {
    // ignore parse failures
  }
  return { ok: res.ok, status: res.status, json: data };
}
