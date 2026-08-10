/**
 * ORDER BOOK — Price-Time Priority Data Structure
 *
 * WHY A SORTED ARRAY WITH BINARY INSERTION?
 * A sorted array gives O(log n) insertion (via binary search for correct position)
 * and O(1) access to the best bid (last element for bids, first for asks).
 * For the scale of this project (thousands, not millions, of resting orders)
 * this is simpler and more cache-friendly than a skip list or red-black tree.
 * At exchange-grade scale you'd want a dedicated price-level linked list with
 * a hash map by price for O(1) insertion, but that adds significant complexity
 * for no meaningful gain here.
 *
 * CONCURRENCY NOTE:
 * Node.js is single-threaded within one event loop. As long as submitOrder()
 * and cancelOrder() are fully synchronous (no awaits), they can never be
 * interleaved — only one call runs to completion before the next one starts.
 * This means the order book is inherently race-free in a single-process setup.
 * If the engine were sharded across multiple processes, each symbol would need
 * to be pinned to exactly one process (e.g. via consistent hashing on symbol)
 * OR guarded by a distributed lock (e.g. Redis SETNX per symbol) to preserve
 * this guarantee.
 */

import { Order, OrderSide } from '../types/index.js';

export class OrderBook {
  /** Bids sorted descending by price, then ascending by createdAt (time priority) */
  private bids: Order[] = [];
  /** Asks sorted ascending by price, then ascending by createdAt (time priority) */
  private asks: Order[] = [];

  /** Index for O(1) lookup by orderId during cancellation */
  private orderIndex: Map<string, { side: OrderSide; arrayIndex: number }> = new Map();

  // ---------------------------------------------------------------------------
  // Public read accessors
  // ---------------------------------------------------------------------------

  getBids(): readonly Order[] {
    return this.bids;
  }

  getAsks(): readonly Order[] {
    return this.asks;
  }

  getBestBid(): Order | undefined {
    return this.bids[0]; // highest price first
  }

  getBestAsk(): Order | undefined {
    return this.asks[0]; // lowest price first
  }

  // ---------------------------------------------------------------------------
  // Insertion
  // ---------------------------------------------------------------------------

  /**
   * Insert a resting order into the correct side of the book, maintaining
   * price-time priority sort order.
   */
  insert(order: Order): void {
    if (order.side === 'buy') {
      this.insertIntoBids(order);
    } else {
      this.insertIntoAsks(order);
    }
    // Index rebuild is cheaper than keeping arrayIndex live through mutations;
    // we rebuild lazily on cancellation instead (see removeById).
  }

  private insertIntoBids(order: Order): void {
    // Binary search for insertion point: bids are sorted price DESC, then createdAt ASC
    let lo = 0;
    let hi = this.bids.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const candidate = this.bids[mid];
      if (
        candidate.price! > order.price! ||
        (candidate.price === order.price && candidate.createdAt <= order.createdAt)
      ) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.bids.splice(lo, 0, order);
  }

  private insertIntoAsks(order: Order): void {
    // Binary search for insertion point: asks are sorted price ASC, then createdAt ASC
    let lo = 0;
    let hi = this.asks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const candidate = this.asks[mid];
      if (
        candidate.price! < order.price! ||
        (candidate.price === order.price && candidate.createdAt <= order.createdAt)
      ) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.asks.splice(lo, 0, order);
  }

  // ---------------------------------------------------------------------------
  // Removal
  // ---------------------------------------------------------------------------

  /**
   * Remove a resting order by id from whichever side it's on.
   * Returns the removed order, or undefined if not found.
   */
  removeById(orderId: string): Order | undefined {
    // Check bids first
    const bidIdx = this.bids.findIndex((o) => o.id === orderId);
    if (bidIdx !== -1) {
      const [removed] = this.bids.splice(bidIdx, 1);
      return removed;
    }
    // Check asks
    const askIdx = this.asks.findIndex((o) => o.id === orderId);
    if (askIdx !== -1) {
      const [removed] = this.asks.splice(askIdx, 1);
      return removed;
    }
    return undefined;
  }

  /**
   * Remove and return the best (first) ask from the book.
   * Used during matching to consume liquidity.
   */
  shiftBestAsk(): Order | undefined {
    return this.asks.shift();
  }

  /**
   * Remove and return the best (first) bid from the book.
   */
  shiftBestBid(): Order | undefined {
    return this.bids.shift();
  }

  /**
   * Put a partially-filled resting order back at the front of its side.
   * Because the resting order was already first (best) when we popped it,
   * it stays first after a partial fill — time priority is preserved.
   */
  unshiftBid(order: Order): void {
    this.bids.unshift(order);
  }

  unshiftAsk(order: Order): void {
    this.asks.unshift(order);
  }
}
