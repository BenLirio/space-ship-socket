// Centralized message-related TypeScript types
export interface OutgoingMessage {
  type: 'echo' | 'error' | 'ping' | 'info' | 'gameState' | 'connected' | 'scoreboard';
  payload?: unknown;
}

export interface IncomingMessage {
  type: string;
  body?: unknown;
  [k: string]: unknown; // Allow arbitrary extra fields for extensibility
}
