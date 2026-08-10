/**
 * MATCHING ENGINE — Price-Time Priority Order Matching
 *
 * CONCURRENCY GUARANTEE (important for interviews):
 * ─────────────────────────────────────────────────
 * Node.js processes JavaScript on a single thread via the event loop. Crucially,
 * a synchronous function runs to completion before ANY other JS can execute —
 * there is no pre-emptive thread switching. This means:
 *
 *   submitOrder() and cancelOrder() are race-free AS LONG AS they are fully
 *   synchronous (no `await`, no I/O calls inside them). A second order cannot
 *   begin matching until the first match fully completes.
 *
 * This guarantee holds for a single process. If you horizontally scale to
 * multiple processes, each symbol MUST be pinned to exactly one process
 * (e.g. via consistent hashing on the symbol string at the load balancer),
 * otherwise two processes could interleave reads/writes on the same order book.
 * Alternatively, you'd need a distributed lock (e.g. Redis SETNX per symbol)
 * before entering the match loop — but that adds latency and complexity.
 *
 * DESIGN PRINCIPLE: Any I/O (database writes, WebSocket broadcasts) must happen
 * in the CALLING LAYER, after this synchronous function returns its results.
 * Never put I/O inside the engine — that would silently break the race-free
 * guarantee by allowing the event loop to process other callbacks mid-match.
 */

import { v4 as uuidv4 } from 'uuid';
import { Order, Trade, OrderBookSnapshot } from '../types/index.js';
import { OrderBook } from './orderBook.js';

export class MatchingEngine {
  private readonly symbol: string;
  private readonly book: OrderBook;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.book = new OrderBook();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Submit an order for matching. FULLY SYNCHRONOUS — no Promises.
   *
   * Returns the list of Trade objects produced by this submission.
   * The caller is responsible for:
   *   1. Persisting the trades and updated order statuses to the DB
   *   2. Broadcasting book/trade updates via WebSocket
   *
   * The incoming `order` object is mutated in place (filledQuantity, status)
   * so the caller can read updated state directly from it after the call.
   */
  submitOrder(order: Order): Trade[] {
    const trades: Trade[] = [];

    if (order.type === 'limit') {
      this.matchLimit(order, trades);
    } else {
      this.matchMarket(order, trades);
    }

    return trades;
  }

  /**
   * Cancel a resting order by id. FULLY SYNCHRONOUS.
   *
   * Returns false if the order is not found in the book (already filled,
   * already cancelled, or never rested here).
   */
  cancelOrder(orderId: string): boolean {
    const removed = this.book.removeById(orderId);
    if (removed) {
      removed.status = 'cancelled';
      return true;
    }
    return false;
  }

  /**
   * Return an aggregated view of the current order book for this symbol.
   * Aggregates quantity per price level — never exposes individual order ids.
   *
   * WHY AGGREGATE: (a) performance — fewer bytes over the wire, (b) privacy —
   * we don't want clients to be able to track competing traders' order ids
   * or infer their identity from order sizes.
   */
  getSnapshot(): OrderBookSnapshot {
    const bids = aggregateLevels(this.book.getBids());
    const asks = aggregateLevels(this.book.getAsks());
    return { symbol: this.symbol, bids, asks };
  }

  /**
   * Load a set of pre-existing resting orders into the book.
   * Used on server restart to rebuild the in-memory book from Postgres
   * (see Module 3 reconciliation step).
   */
  loadOrders(orders: Order[]): void {
    for (const order of orders) {
      this.book.insert(order);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal matching logic
  // ---------------------------------------------------------------------------

  private matchLimit(incoming: Order, trades: Trade[]): void {
    const remainingQty = () => incoming.quantity - incoming.filledQuantity;

    while (remainingQty() > 0) {
      const opposing =
        incoming.side === 'buy' ? this.book.getBestAsk() : this.book.getBestBid();

      if (!opposing) break; // No liquidity on the other side

      // Price constraint check for limit orders:
      // A buy limit matches asks only if ask price <= limit price.
      // A sell limit matches bids only if bid price >= limit price.
      if (incoming.side === 'buy' && opposing.price! > incoming.price!) break;
      if (incoming.side === 'sell' && opposing.price! < incoming.price!) break;

      // Pop the best opposing order off the book for mutation
      if (incoming.side === 'buy') {
        this.book.shiftBestAsk();
      } else {
        this.book.shiftBestBid();
      }

      const trade = this.executeTrade(incoming, opposing);
      trades.push(trade);

      // If the opposing order still has remaining quantity, put it back at front
      if (opposing.status !== 'filled') {
        if (opposing.side === 'buy') {
          this.book.unshiftBid(opposing);
        } else {
          this.book.unshiftAsk(opposing);
        }
      }
    }

    // If the limit order still has unfilled quantity, it rests in the book
    if (remainingQty() > 0 && incoming.status !== 'cancelled') {
      this.book.insert(incoming);
    }
  }

  private matchMarket(incoming: Order, trades: Trade[]): void {
    const remainingQty = () => incoming.quantity - incoming.filledQuantity;

    while (remainingQty() > 0) {
      const opposing =
        incoming.side === 'buy' ? this.book.getBestAsk() : this.book.getBestBid();

      if (!opposing) {
        // Book is empty — market orders do NOT rest; signal via status so caller
        // can decide (cancel it, log a warning, notify the user, etc.)
        // We intentionally do not silently drop it — the partial fill is visible.
        if (incoming.filledQuantity > 0) {
          incoming.status = 'partially_filled';
        }
        // If nothing filled at all, leave status as 'pending' — the caller should
        // cancel it, since a market order with no available liquidity is rejected.
        return;
      }

      // Pop and match — market orders have no price constraint
      if (incoming.side === 'buy') {
        this.book.shiftBestAsk();
      } else {
        this.book.shiftBestBid();
      }

      const trade = this.executeTrade(incoming, opposing);
      trades.push(trade);

      if (opposing.status !== 'filled') {
        if (opposing.side === 'buy') {
          this.book.unshiftBid(opposing);
        } else {
          this.book.unshiftAsk(opposing);
        }
      }
    }
  }

  /**
   * Execute a single trade between an incoming order and a resting opposing order.
   * Mutates both orders' filledQuantity and status.
   * The trade price is ALWAYS the resting order's price — this is standard exchange
   * practice (price improvement for the aggressor, price certainty for the resting order).
   */
  private executeTrade(incoming: Order, resting: Order): Trade {
    const remaining = incoming.quantity - incoming.filledQuantity;
    const restingRemaining = resting.quantity - resting.filledQuantity;
    const tradeQty = Math.min(remaining, restingRemaining);

    incoming.filledQuantity += tradeQty;
    resting.filledQuantity += tradeQty;

    incoming.status =
      incoming.filledQuantity >= incoming.quantity ? 'filled' : 'partially_filled';
    resting.status =
      resting.filledQuantity >= resting.quantity ? 'filled' : 'partially_filled';

    const buyOrderId = incoming.side === 'buy' ? incoming.id : resting.id;
    const sellOrderId = incoming.side === 'sell' ? incoming.id : resting.id;

    return {
      id: uuidv4(),
      symbol: this.symbol,
      price: resting.price!, // trade at the resting order's limit price
      quantity: tradeQty,
      buyOrderId,
      sellOrderId,
      executedAt: Date.now(),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Aggregate individual orders into price-level summaries.
 * Input must already be sorted (bids DESC, asks ASC) — we just accumulate.
 */
function aggregateLevels(
  orders: readonly Order[]
): { price: number; totalQuantity: number }[] {
  const levels: Map<number, number> = new Map();
  for (const order of orders) {
    const remaining = order.quantity - order.filledQuantity;
    if (remaining <= 0) continue;
    const price = order.price!;
    levels.set(price, (levels.get(price) ?? 0) + remaining);
  }

  // Maintain original sort order: bids come in DESC, asks in ASC
  // We need to preserve that order when converting Map -> Array
  const seen = new Set<number>();
  const result: { price: number; totalQuantity: number }[] = [];
  for (const order of orders) {
    if (!seen.has(order.price!)) {
      seen.add(order.price!);
      const totalQuantity = levels.get(order.price!)!;
      if (totalQuantity > 0) {
        result.push({ price: order.price!, totalQuantity });
      }
    }
  }
  return result;
}
