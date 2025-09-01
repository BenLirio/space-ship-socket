import type { WebSocketServer } from 'ws';
import type { GameState } from '../types/game.js';

export interface InputState {
  keysDown: Set<string>;
  joystick?: { x: number; y: number };
  lastInputAt: number; // epoch ms
  lastFireAt?: number; // cooldown tracking
  muzzleFlashUntil?: number; // epoch ms until which muzzle flash is considered active
}

export interface InternalLoopState {
  simInterval: NodeJS.Timeout;
  broadcastInterval: NodeJS.Timeout;
  wss: WebSocketServer;
  gameState: GameState; // authoritative snapshot we broadcast
  inputs: Record<string, InputState>; // latest input per entity id
}
