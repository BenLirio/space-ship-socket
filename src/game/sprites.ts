export function preferredSpriteUrl(
  sprites?: Record<string, { url?: string } | undefined>,
): string | undefined {
  if (!sprites) return undefined;
  const order = [
    'thrustersOffMuzzleOff',
    'thrustersOffMuzzleOn',
    'thrustersOnMuzzleOff',
    'thrustersOnMuzzleOn',
  ];
  for (const k of order) {
    const url = sprites[k]?.url;
    if (url) return url;
  }
  return Object.values(sprites).find((s) => s?.url)?.url;
}
