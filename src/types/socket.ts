import type { WebSocket } from 'ws';

export type CustomWebSocket = WebSocket & { id: string; ip?: string };
