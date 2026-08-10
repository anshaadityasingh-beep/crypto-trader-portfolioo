/**
 * Unit tests for the MatchingEngine.
 * Tests cover all scenarios required by the spec:
 *   - Limit order matching
 *   - Partial fills across multiple price levels
 *   - Market order consuming multiple levels
 *   - Market order with insufficient liquidity (partial fill signal)
 *   - Cancellation
 *   - Price-time priority (earlier order at same price fills first)
 *   - Snapshot aggregation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MatchingEngine } from './matchingEngine.js';
import { Order } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let orderCounter = 0;

function makeOrder(overrides: Partial<Order> & Pick<Order, 'side' | 'type'>): Order {
  orderCounter++;
  return {
    id: `order-${orderCounter}`,
    userId: 'user-test',
    symbol: 'BTC-USD',
    price: null,
    quantity: 1,
    filledQuantity: 0,
    status: 'pending',
    createdAt: Date.now() + orderCounter, // monotonically increasing for time priority
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MatchingEngine', () => {
  let engine: MatchingEngine;

  beforeEach(() => {
    orderCounter = 0;
    engine = new MatchingEngine('BTC-USD');
  });

  // ─── 1. Limit order matches immediately against a resting opposite order ───

  it('limit buy matches immediately against a resting limit ask', () => {
    // Resting sell at 100
    const ask = makeOrder({ side: 'sell', type: 'limit', price: 100, quantity: 1 });
    const askTrades = engine.submitOrder(ask);
    expect(askTrades).toHaveLength(0); // no match yet, just rests
    expect(ask.status).toBe('pending');

    // Incoming buy limit at 100 (or higher) should match
    const bid = makeOrder({ side: 'buy', type: 'limit', price: 100, quantity: 1 });
    const trades = engine.submitOrder(bid);

    expect(trades).toHaveLength(1);
    expect(trades[0].price).toBe(100); // trade at resting (ask) price
    expect(trades[0].quantity).toBe(1);
    expect(trades[0].buyOrderId).toBe(bid.id);
    expect(trades[0].sellOrderId).toBe(ask.id);

    expect(bid.status).toBe('filled');
    expect(ask.status).toBe('filled');

    // Book should be empty
    const snap = engine.getSnapshot();
    expect(snap.bids).toHaveLength(0);
    expect(snap.asks).toHaveLength(0);
  });

  it('limit order does NOT match if price constraint not satisfied', () => {
    // Resting ask at 105 — a buy limit at 100 should NOT match
    const ask = makeOrder({ side: 'sell', type: 'limit', price: 105, quantity: 1 });
    engine.submitOrder(ask);

    const bid = makeOrder({ side: 'buy', type: 'limit', price: 100, quantity: 1 });
    const trades = engine.submitOrder(bid);

    expect(trades).toHaveLength(0);
    expect(bid.status).toBe('pending'); // rests in book

    const snap = engine.getSnapshot();
    expect(snap.bids).toHaveLength(1);
    expect(snap.asks).toHaveLength(1);
  });

  // ─── 2. Partial fill across multiple price levels, remainder rests ───────

  it('incoming limit buy partially fills across multiple ask levels, remainder rests', () => {
    // Two resting asks at different price levels
    const ask1 = makeOrder({ side: 'sell', type: 'limit', price: 100, quantity: 2 });
    const ask2 = makeOrder({ side: 'sell', type: 'limit', price: 102, quantity: 2 });
    engine.submitOrder(ask1);
    engine.submitOrder(ask2);

    // Incoming buy for 5 units at limit 103 — can match both levels
    const bid = makeOrder({ side: 'buy', type: 'limit', price: 103, quantity: 5 });
    const trades = engine.submitOrder(bid);

    // Should produce 2 trades (one per ask level)
    expect(trades).toHaveLength(2);
    expect(trades[0].price).toBe(100); // best ask first
    expect(trades[0].quantity).toBe(2);
    expect(trades[1].price).toBe(102);
    expect(trades[1].quantity).toBe(2);

    // Incoming buy is partially filled (4 of 5 units matched)
    expect(bid.filledQuantity).toBe(4);
    expect(bid.status).toBe('partially_filled');

    // Remaining 1 unit should rest in the bid book
    const snap = engine.getSnapshot();
    expect(snap.bids).toHaveLength(1);
    expect(snap.bids[0].price).toBe(103);
    expect(snap.bids[0].totalQuantity).toBeCloseTo(1);
    expect(snap.asks).toHaveLength(0);
  });

  // ─── 3. Market order consumes multiple price levels ───────────────────────

  it('market buy consumes multiple ask levels until fully filled', () => {
    const ask1 = makeOrder({ side: 'sell', type: 'limit', price: 100, quantity: 1 });
    const ask2 = makeOrder({ side: 'sell', type: 'limit', price: 101, quantity: 1 });
    const ask3 = makeOrder({ side: 'sell', type: 'limit', price: 102, quantity: 1 });
    engine.submitOrder(ask1);
    engine.submitOrder(ask2);
    engine.submitOrder(ask3);

    const marketBuy = makeOrder({ side: 'buy', type: 'market', price: null, quantity: 3 });
    const trades = engine.submitOrder(marketBuy);

    expect(trades).toHaveLength(3);
    expect(trades.map((t) => t.price)).toEqual([100, 101, 102]);
    expect(marketBuy.status).toBe('filled');
    expect(marketBuy.filledQuantity).toBe(3);

    const snap = engine.getSnapshot();
    expect(snap.asks).toHaveLength(0);
  });

  // ─── 4. Market order with insufficient liquidity signals partial fill ─────

  it('market order with insufficient liquidity returns partial fill and signals unfilled remainder', () => {
    // Only 0.5 BTC available, order wants 1 BTC
    const ask = makeOrder({ side: 'sell', type: 'limit', price: 100, quantity: 0.5 });
    engine.submitOrder(ask);

    const marketBuy = makeOrder({ side: 'buy', type: 'market', price: null, quantity: 1 });
    const trades = engine.submitOrder(marketBuy);

    expect(trades).toHaveLength(1);
    expect(trades[0].quantity).toBe(0.5);
    expect(marketBuy.filledQuantity).toBe(0.5);
    expect(marketBuy.status).toBe('partially_filled');

    // Market order must NOT rest in the book
    const snap = engine.getSnapshot();
    expect(snap.bids).toHaveLength(0);
  });

  it('market order with zero liquidity leaves status as pending (signals full rejection to caller)', () => {
    const marketSell = makeOrder({ side: 'sell', type: 'market', price: null, quantity: 1 });
    const trades = engine.submitOrder(marketSell);

    expect(trades).toHaveLength(0);
    expect(marketSell.filledQuantity).toBe(0);
    // Status remains 'pending' — caller should cancel it
    expect(marketSell.status).toBe('pending');
  });

  // ─── 5. Cancellation ────────────────────────────────────────────────────

  it('cancelOrder removes a resting limit order from the book', () => {
    const ask = makeOrder({ side: 'sell', type: 'limit', price: 100, quantity: 1 });
    engine.submitOrder(ask);

    const result = engine.cancelOrder(ask.id);

    expect(result).toBe(true);
    expect(ask.status).toBe('cancelled');

    // Book should be empty — a subsequent buy should find no liquidity
    const bid = makeOrder({ side: 'buy', type: 'limit', price: 100, quantity: 1 });
    const trades = engine.submitOrder(bid);
    expect(trades).toHaveLength(0);
  });

  it('cancelOrder returns false for an order that does not exist in the book', () => {
    const result = engine.cancelOrder('nonexistent-id');
    expect(result).toBe(false);
  });

  it('cancelOrder returns false for an already-filled order', () => {
    const ask = makeOrder({ side: 'sell', type: 'limit', price: 100, quantity: 1 });
    const bid = makeOrder({ side: 'buy', type: 'limit', price: 100, quantity: 1 });
    engine.submitOrder(ask);
    engine.submitOrder(bid);

    // Ask is fully filled — not in the book anymore
    expect(ask.status).toBe('filled');
    const result = engine.cancelOrder(ask.id);
    expect(result).toBe(false);
  });

  // ─── 6. Price-time priority: earlier order at same price fills first ─────

  it('two resting bids at the same price: earlier createdAt fills first', () => {
    // Both asks want to sell — which bid gets filled first?
    const bid1 = makeOrder({
      id: 'bid-early',
      side: 'buy',
      type: 'limit',
      price: 100,
      quantity: 1,
      createdAt: 1000, // earlier
    });
    const bid2 = makeOrder({
      id: 'bid-late',
      side: 'buy',
      type: 'limit',
      price: 100,
      quantity: 1,
      createdAt: 2000, // later
    });

    engine.submitOrder(bid1);
    engine.submitOrder(bid2);

    // Incoming sell — can only fill one unit (quantity=1), should hit bid1 first
    const ask = makeOrder({ side: 'sell', type: 'limit', price: 100, quantity: 1 });
    const trades = engine.submitOrder(ask);

    expect(trades).toHaveLength(1);
    expect(trades[0].buyOrderId).toBe('bid-early');
    expect(bid1.status).toBe('filled');
    expect(bid2.status).toBe('pending'); // still resting
  });

  it('two resting asks at the same price: earlier createdAt fills first', () => {
    const ask1 = makeOrder({
      id: 'ask-early',
      side: 'sell',
      type: 'limit',
      price: 100,
      quantity: 1,
      createdAt: 1000,
    });
    const ask2 = makeOrder({
      id: 'ask-late',
      side: 'sell',
      type: 'limit',
      price: 100,
      quantity: 1,
      createdAt: 2000,
    });

    engine.submitOrder(ask1);
    engine.submitOrder(ask2);

    const bid = makeOrder({ side: 'buy', type: 'limit', price: 100, quantity: 1 });
    const trades = engine.submitOrder(bid);

    expect(trades).toHaveLength(1);
    expect(trades[0].sellOrderId).toBe('ask-early');
    expect(ask1.status).toBe('filled');
    expect(ask2.status).toBe('pending');
  });

  // ─── 7. getSnapshot() correctly aggregates quantity at each price level ──

  it('getSnapshot aggregates quantities at each price level', () => {
    // Two bids at 100, one at 99
    engine.submitOrder(makeOrder({ side: 'buy', type: 'limit', price: 100, quantity: 1.5 }));
    engine.submitOrder(makeOrder({ side: 'buy', type: 'limit', price: 100, quantity: 0.5 }));
    engine.submitOrder(makeOrder({ side: 'buy', type: 'limit', price: 99, quantity: 2 }));

    // Two asks at 101, one at 102
    engine.submitOrder(makeOrder({ side: 'sell', type: 'limit', price: 101, quantity: 1 }));
    engine.submitOrder(makeOrder({ side: 'sell', type: 'limit', price: 101, quantity: 2 }));
    engine.submitOrder(makeOrder({ side: 'sell', type: 'limit', price: 102, quantity: 0.5 }));

    const snap = engine.getSnapshot();

    // Bids: sorted highest first
    expect(snap.bids).toHaveLength(2);
    expect(snap.bids[0]).toEqual({ price: 100, totalQuantity: 2 });
    expect(snap.bids[1]).toEqual({ price: 99, totalQuantity: 2 });

    // Asks: sorted lowest first
    expect(snap.asks).toHaveLength(2);
    expect(snap.asks[0]).toEqual({ price: 101, totalQuantity: 3 });
    expect(snap.asks[1]).toEqual({ price: 102, totalQuantity: 0.5 });
  });

  // ─── 8. loadOrders (reconciliation support) ──────────────────────────────

  it('loadOrders pre-populates the book and orders can match against loaded orders', () => {
    const restingAsk: Order = {
      id: 'persisted-ask',
      userId: 'bot-user',
      symbol: 'BTC-USD',
      side: 'sell',
      type: 'limit',
      price: 100,
      quantity: 1,
      filledQuantity: 0,
      status: 'pending',
      createdAt: 500,
    };

    engine.loadOrders([restingAsk]);

    const bid = makeOrder({ side: 'buy', type: 'limit', price: 100, quantity: 1 });
    const trades = engine.submitOrder(bid);

    expect(trades).toHaveLength(1);
    expect(trades[0].sellOrderId).toBe('persisted-ask');
    expect(restingAsk.status).toBe('filled');
  });
});
