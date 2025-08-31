#!/usr/bin/env node
/* eslint-env node */
// Simple WebSocket/WSS smoke test connecting to deployed host and expecting a pong reply.
// Usage: HOST=ec2-public-dns [PORT=8080] [SCHEME=auto|ws|wss] [INSECURE=1] node scripts/smoke-ws.js
import { WebSocket } from 'ws';

const host = process.env.HOST;
if (!host) {
  console.error('HOST env var required');
  process.exit(2);
}

const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 8000);
const port = Number(process.env.PORT || 8080);
const schemeEnv = process.env.SCHEME || 'auto';
// Auto: prefer wss only if port is 443 or FORCE_WSS=1; otherwise start with ws to avoid hostname mismatch during bootstrap.
// You can still force by SCHEME=wss or FORCE_WSS=1.
const initialScheme =
  schemeEnv === 'auto' ? (port === 443 || process.env.FORCE_WSS === '1' ? 'wss' : 'ws') : schemeEnv;

let attemptedFallback = false;
let currentScheme = initialScheme;
let ws; // current WebSocket instance
let gotPong = false;
let closed = false;

function buildOptions() {
  const o = {};
  if (currentScheme === 'wss' && process.env.INSECURE === '1') {
    // @ts-expect-error dynamic
    o.rejectUnauthorized = false; // bypass cert validation (including hostname)
    console.log('[warn] INSECURE=1 set: TLS verification disabled');
  }
  return o;
}

function connect() {
  const url = `${currentScheme}://${host}:${port}`;
  console.log('Smoke test connecting to', url);
  ws = new WebSocket(url, buildOptions());
  attachHandlers();
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
    // Hostname mismatch or other TLS issue: attempt fallback to ws if we started with wss & not yet tried ws.
    if (currentScheme === 'wss' && !attemptedFallback && schemeEnv === 'auto') {
      const name = (err && err.code) || '';
      if (name.includes('ERR_TLS') || /certificate|hostname/i.test(String(err))) {
        console.log(
          '[info] TLS error detected; falling back to ws. Set FORCE_WSS=1 to disable fallback.',
        );
        attemptedFallback = true;
        cleanupForRetry();
        currentScheme = 'ws';
        connect();
        return;
      }
    }
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

function cleanupForRetry() {
  try {
    ws.removeAllListeners();
  } catch {
    /* ignore */
  }
  try {
    ws.terminate();
  } catch {
    /* ignore */
  }
}

connect();

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
