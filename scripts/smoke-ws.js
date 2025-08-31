#!/usr/bin/env node
/* eslint-env node */
// Simple WebSocket smoke test connecting to deployed host:8080 and expecting a pong reply.
// Usage: HOST=ec2-public-dns node scripts/smoke-ws.js
import { WebSocket } from 'ws';

const host = process.env.HOST;
if (!host) {
  console.error('HOST env var required');
  process.exit(2);
}

const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 8000);
const url = `ws://${host}:8080`;
console.log('Smoke test connecting to', url);
const ws = new WebSocket(url);
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
    } catch (e) {
      /* ignore */
    }
  }
  process.exit(code);
}
