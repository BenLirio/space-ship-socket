import type { WebSocketServer } from 'ws';

export interface StartedServer {
  wss: WebSocketServer;
  port: number;
  stop: () => Promise<void>;
}
