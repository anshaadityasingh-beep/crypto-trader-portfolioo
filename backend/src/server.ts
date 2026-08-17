/**
 * server.ts — Express + WebSocket application entry point.
 *
 * Assembly order:
 *   1. Create Express app with middleware and routes
 *   2. Reconcile in-memory order book from Postgres (survive restarts)
 *   3. Create HTTP server from the Express app
 *   4. Attach WebSocket server to the same HTTP server (same port)
 *   5. Select broadcaster implementation based on REDIS_URL env var
 *   6. Start listening
 */

import http from 'http';
import express from 'express';
import cors from 'cors';
import url from 'url';
import { prisma } from './db/client.js';
import { getEngine } from './engine/index.js';
import { errorHandler } from './api/middleware/errorHandler.js';
import { OrderSide, OrderType, OrderStatus } from './types/index.js';

import authRoutes from './api/routes/auth.js';
import walletRoutes from './api/routes/wallet.js';
import ordersRoutes from './api/routes/orders.js';
import marketDataRoutes from './api/routes/marketData.js';

import { createWsServer } from './ws/wsServer.js';
import { InMemoryBroadcaster } from './broadcaster/inMemoryBroadcaster.js';
import { Broadcaster } from './broadcaster/broadcaster.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

// CORS configured to allow localhost in dev. For production, restrict to frontend URL (Module 8).
app.use(cors());
app.use(express.json());

// Health check — used by Render's deployment health checks (Module 8)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Mount REST API routes
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api', marketDataRoutes); // mounts /api/orderbook/:symbol and /api/trades/:symbol

// Centralized error handling middleware
app.use(errorHandler);

async function startServer() {
  console.log('[server] Starting server initialization...');

  // ── 1. Reconciliation: Rebuild in-memory book from DB ──────────────────
  const openOrders = await prisma.order.findMany({
    where: {
      status: { in: ['pending', 'partially_filled'] },
    },
    orderBy: { createdAt: 'asc' }, // Maintain time priority
  });

  const ordersBySymbol: Record<string, any[]> = {};
  for (const order of openOrders) {
    if (!ordersBySymbol[order.symbol]) {
      ordersBySymbol[order.symbol] = [];
    }
    ordersBySymbol[order.symbol].push({
      id: order.id,
      userId: order.userId,
      symbol: order.symbol,
      side: order.side as OrderSide,
      type: order.type as OrderType,
      price: order.price ? order.price.toNumber() : null,
      quantity: order.quantity.toNumber(),
      filledQuantity: order.filledQuantity.toNumber(),
      status: order.status as OrderStatus,
      createdAt: order.createdAt.getTime(),
    });
  }

  for (const [symbol, orders] of Object.entries(ordersBySymbol)) {
    const engine = getEngine(symbol);
    engine.loadOrders(orders);
    console.log(`[server] Loaded ${orders.length} open orders for ${symbol} into matching engine`);
  }

  // ── 2. Start Market Maker Bot ────────────────────────────────────────────
  const { startMarketMaker } = await import('./bots/marketMaker.js');
  startMarketMaker('BTC-USD');

  // ── 3. Select broadcaster implementation ───────────────────────────────
  let broadcaster: Broadcaster;

  if (process.env.REDIS_URL) {
    // Dynamic import so ioredis isn't loaded (or required) when not using Redis
    const { RedisBroadcaster } = await import('./broadcaster/redisBroadcaster.js');
    broadcaster = new RedisBroadcaster(process.env.REDIS_URL);
    console.log('[server] Using RedisBroadcaster (horizontal scaling enabled)');
  } else {
    broadcaster = new InMemoryBroadcaster();
    console.log('[server] Using InMemoryBroadcaster (single instance mode)');
  }

  // ── 3. Create HTTP server and attach WebSocket gateway ─────────────────
  const httpServer = http.createServer(app);
  createWsServer(httpServer, broadcaster);

  // ── 4. Start listening ─────────────────────────────────────────────────
  httpServer.listen(PORT, () => {
    console.log(`[server] HTTP + WebSocket listening on port ${PORT}`);
  });

  return { app, httpServer };
}

// Run if this file is the entry point (not imported for testing)
if (process.argv[1] && import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

export { app, startServer };
