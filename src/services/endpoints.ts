// Centralized API endpoints with env overrides and sane prod/dev defaults

const PROD_BASE = 'https://9rc13jr0p2.execute-api.us-east-1.amazonaws.com';
const DEV_BASE = 'http://localhost:3000';

function base(): string {
  return process.env.NODE_ENV === 'production' ? PROD_BASE : DEV_BASE;
}

function withBase(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base()}${p}`;
}

export const GENERATE_SHIP_URL = process.env.GENERATE_SHIP_URL || withBase('/generate-space-ship');

export const GENERATE_SPRITE_SHEET_URL =
  process.env.GENERATE_SPRITE_SHEET_URL || withBase('/generate-sprite-sheet');

export const RESIZE_SPRITES_URL = process.env.RESIZE_SPRITES_URL || withBase('/resize');

export const DIFF_BOUNDING_BOX_URL =
  process.env.DIFF_BOUNDING_BOX_URL || withBase('/diff-bounding-box');

export const NAME_SHIP_URL = process.env.NAME_SHIP_URL || withBase('/name-ship');

export const isProd = () => process.env.NODE_ENV === 'production';
