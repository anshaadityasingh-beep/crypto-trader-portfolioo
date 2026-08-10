/**
 * WebSocket Gateway — Real-time nervous system of the trading engine.
 *
 * Responsibilities:
 *   1. Accept WebSocket connections on the same HTTP server as Express
 *   2. Authenticate clients via JWT (passed as query param `?token=...`)
 *   3. Let clients subscribe/unsubscribe to symbols for live updates
 *   4. Broadcast book snapshots and trades to all subscribers of a symbol
 *   5. Send private order_update messages only to the owning user's connections
 *
 * RECONNECTION STRATEGY (design trade-off, good interview talking point):
 *   When a client reconnects, it re-subscribes and immediately receives a fresh
 *   order book snapshot. We do NOT attempt delta-replay (tracking which messages
 *   each client has seen and replaying missed ones). A fresh snapshot is simpler,
 *   always correct, and avoids an entire class of bugs around sequence tracking
 *   and gap detection. The cost is slightly more bandwidth on reconnect — but
 *   snapshots are small (aggregated price levels, not individual orders), so
 *   this is a worthwhile trade-off for a system at this scale.
 */

import { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { URL } from 'url';
import { Broadcaster } from '../broadcaster/broadcaster.js';
import { getEngine } from '../engine/index.js';
import { orderEvents } from '../api/events.js';
import { WsMessage, Order, Trade, OrderBookSnapshot } from '../types/index.js';

// ---------------------------------------------------------------------------
// Per-client state
// ---------------------------------------------------------------------------

interface ClientState {
  ws: WebSocket;
  userId: string | null;          // null if unauthenticated
  subscribedSymbols: Set<string>; // symbols this client is listening to
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** userId → set of WebSocket connections (a user can have multiple tabs) */
const userConnections = new Map<string, Set<WebSocket>>();

/** symbol → set of WebSocket connections subscribed to that symbol */
const symbolSubscribers = new Map<string, Set<WebSocket>>();

/** WebSocket → its associated state */
const clientStates = new Map<WebSocket, ClientState>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJson(ws: WebSocket, data: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function addToSet<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

function removeFromSet<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key);
  if (!set) return;
  set.delete(value);
  if (set.size === 0) map.delete(key);
}

// ---------------------------------------------------------------------------
// Subscription handling
// ---------------------------------------------------------------------------

function handleSubscribe(client: ClientState, symbol: string): void {
  client.subscribedSymbols.add(symbol);
  addToSet(symbolSubscribers, symbol, client.ws);

  // Immediately send a full snapshot so the client has current state
  const engine = getEngine(symbol);
  const snapshot = engine.getSnapshot();
  sendJson(client.ws, { type: 'snapshot', symbol, data: snapshot } satisfies WsMessage);
}

function handleUnsubscribe(client: ClientState, symbol: string): void {
  client.subscribedSymbols.delete(symbol);
  removeFromSet(symbolSubscribers, symbol, client.ws);
}

// ---------------------------------------------------------------------------
// Client cleanup on disconnect
// ---------------------------------------------------------------------------

function cleanupClient(ws: WebSocket): void {
  const state = clientStates.get(ws);
  if (!state) return;

  // Remove from all symbol subscription groups
  for (const symbol of state.subscribedSymbols) {
    removeFromSet(symbolSubscribers, symbol, ws);
  }

  // Remove from userId connection map
  if (state.userId) {
    removeFromSet(userConnections, state.userId, ws);
  }

  clientStates.delete(ws);
}

// ---------------------------------------------------------------------------
// Broadcast functions (called by event listeners)
// ---------------------------------------------------------------------------

function broadcastToSymbol(symbol: string, message: WsMessage): void {
  const subscribers = symbolSubscribers.get(symbol);
  if (!subscribers) return;

  const payload = JSON.stringify(message);
  for (const ws of subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function sendToUser(userId: string, message: WsMessage): void {
  const connections = userConnections.get(userId);
  if (!connections) return;

  const payload = JSON.stringify(message);
  for (const ws of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

// ---------------------------------------------------------------------------
// Wire up event listeners from the REST API (orderEvents emitter)
// ---------------------------------------------------------------------------

function wireOrderEvents(): void {
  orderEvents.on('book_update', (symbol: string, snapshot: OrderBookSnapshot) => {
    broadcastToSymbol(symbol, { type: 'book_update', symbol, data: snapshot });
  });

  orderEvents.on('trade', (symbol: string, trade: Trade) => {
    broadcastToSymbol(symbol, { type: 'trade', symbol, data: trade });
  });

  orderEvents.on('order_update', (userId: string, order: Order) => {
    sendToUser(userId, { type: 'order_update', userId, data: order });
  });
}

// ---------------------------------------------------------------------------
// WebSocket server setup
// ---------------------------------------------------------------------------

export function createWsServer(httpServer: HTTPServer, _broadcaster: Broadcaster): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer });

  // Wire event listeners once
  wireOrderEvents();

  wss.on('connection', (ws: WebSocket, req) => {
    // --- Authentication via JWT query param ---
    // e.g. ws://localhost:3001?token=eyJ...
    let userId: string | null = null;

    try {
      const url = new URL(req.url ?? '', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      if (token) {
        const secret = process.env.JWT_SECRET;
        if (secret) {
          const decoded = jwt.verify(token, secret) as { userId: string };
          userId = decoded.userId;
        }
      }
    } catch {
      // Token invalid or missing — client connects as unauthenticated.
      // They can still subscribe to public market data (book snapshots, trades)
      // but won't receive private order_update messages.
    }

    const clientState: ClientState = {
      ws,
      userId,
      subscribedSymbols: new Set(),
    };
    clientStates.set(ws, clientState);

    // Track this connection under its userId (if authenticated)
    if (userId) {
      addToSet(userConnections, userId, ws);
    }

    // --- Message handling ---
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          case 'subscribe':
            if (typeof msg.symbol === 'string') {
              handleSubscribe(clientState, msg.symbol);
            }
            break;

          case 'unsubscribe':
            if (typeof msg.symbol === 'string') {
              handleUnsubscribe(clientState, msg.symbol);
            }
            break;

          default:
            sendJson(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
        }
      } catch {
        sendJson(ws, { type: 'error', message: 'Invalid JSON' });
      }
    });

    // --- Cleanup on disconnect ---
    ws.on('close', () => {
      cleanupClient(ws);
    });

    ws.on('error', () => {
      cleanupClient(ws);
    });
  });

  console.log('[ws] WebSocket server attached to HTTP server');
  return wss;
}
