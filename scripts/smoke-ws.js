#!/usr/bin/env node
/* eslint-env node */
// Simple WebSocket/WSS smoke test connecting to deployed host and expecting a pong reply.
// Usage: HOST=ec2-public-dns [PORT=443] [SCHEME=auto|ws|wss] [INSECURE=1] node scripts/smoke-ws.js
import { WebSocket } from 'ws';

const host = process.env.HOST;
if (!host) {
  console.error('HOST env var required');
  process.exit(2);
}

const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 8000);
const port = Number(process.env.PORT || 443);
const schemeEnv = process.env.SCHEME || 'auto';
const scheme = schemeEnv === 'auto' ? (port === 443 ? 'wss' : 'ws') : schemeEnv;

const url = `${scheme}://${host}${(scheme === 'wss' && port === 443) || (scheme === 'ws' && port === 80) ? '' : `:${port}`}`;
console.log('Smoke test connecting to', url);
const wsOptions = {};
if (scheme === 'wss' && process.env.INSECURE === '1') {
  // @ts-expect-error allow dynamic option; for self-signed / bootstrap only
  wsOptions.rejectUnauthorized = false;
  console.log('[warn] INSECURE=1 set: TLS certificate verification disabled');
}
const ws = new WebSocket(url, wsOptions);
let gotPong = false;
let closed = false;

const timeout = setTimeout(() => {
  if (!gotPong) {
    console.error('Smoke test timeout without pong');
    safeExit(1);
  }
}, timeoutMs);

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

function safeExit(code) {
  if (!closed) {
    try {
      ws.terminate();
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}
