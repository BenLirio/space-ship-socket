import { startServer } from './app.js';

const PORT = Number(process.env.PORT) || 8080;

if (process.env.NODE_ENV !== 'test') {
  // Fire and forget normal startup
  void startServer(PORT);
}

export {}; // keep module context
