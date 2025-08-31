#!/usr/bin/env node
/* eslint-env node */
// Simple WebSocket/WSS smoke test connecting to a host and expecting a pong reply.
// Usage: HOST=your-host [PORT=8080] [SCHEME=ws|wss] [INSECURE=1] node scripts/smoke-ws.js
// Defaults: PORT=8080 SCHEME=ws; INSECURE=1 only affects wss (disables TLS verification).
import { WebSocket } from 'ws';

const host = process.env.HOST;
if (!host) {
  console.error('HOST env var required');
  process.exit(2);
}

const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 8000);
const port = Number(process.env.PORT || 8080);
const scheme = process.env.SCHEME || 'ws'; // simplified: no auto / fallback logic

if (!['ws', 'wss'].includes(scheme)) {
  console.error(`Invalid SCHEME '${scheme}' (expected ws or wss)`);
  process.exit(2);
}

let ws;
let gotPong = false;
let closed = false;
let timeout;

function buildOptions() {
  const o = {};
  if (scheme === 'wss' && process.env.INSECURE === '1') {
    // @ts-expect-error attached dynamically
    o.rejectUnauthorized = false;
    console.log('[warn] INSECURE=1 set: TLS verification disabled');
  }
  return o;
}

function connect() {
  const url = `${scheme}://${host}:${port}`;
  console.log('Smoke test connecting to', url);
  ws = new WebSocket(url, buildOptions());
  attachHandlers();
  timeout = setTimeout(() => {
    if (!gotPong) {
      console.error('Smoke test timeout without pong');
      safeExit(1);
    }
  }, timeoutMs);
}

function attachHandlers() {
  ws.on('open', () => {
    ws.send('ping');
  });

  ws.on('message', (data) => {
    const txt = data.toString();
    if (txt.includes('pong')) {
      gotPong = true;
      console.log('Received pong');
      ws.close();
    } else {
      console.log('Received non-pong message:', txt.slice(0, 100));
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error', err);
  });

  ws.on('close', () => {
    closed = true;
    clearTimeout(timeout);
    if (!gotPong) {
      console.error('Closed before pong');
      safeExit(1);
    } else {
      console.log('Smoke test passed');
      safeExit(0);
    }
  });
}

function safeExit(code) {
  if (!closed && ws) {
    try {
      ws.terminate();
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}

connect();
