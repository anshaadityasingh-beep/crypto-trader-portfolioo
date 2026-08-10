/**
 * Shared TypeScript types for the Real-Time Crypto Trading Engine.
 * Every module imports from here — keeping them in one place ensures consistency
 * between the matching engine, REST API, WebSocket gateway, and persistence layer.
 */

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'pending' | 'partially_filled' | 'filled' | 'cancelled';

export interface Order {
  id: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: number | null; // null for market orders
  quantity: number;
  filledQuantity: number;
  status: OrderStatus;
  createdAt: number; // epoch ms — used for time priority within the same price level
}

export interface Trade {
  id: string;
  symbol: string;
  price: number;
  quantity: number;
  buyOrderId: string;
  sellOrderId: string;
  executedAt: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  bids: { price: number; totalQuantity: number }[]; // sorted high to low
  asks: { price: number; totalQuantity: number }[]; // sorted low to high
}

// ---------------------------------------------------------------------------
// WebSocket message discriminated union (extended in Module 4)
// ---------------------------------------------------------------------------

/** Server → Client messages (broadcast or targeted) */
export type WsMessage =
  | { type: 'snapshot'; symbol: string; data: OrderBookSnapshot }
  | { type: 'book_update'; symbol: string; data: OrderBookSnapshot }
  | { type: 'trade'; symbol: string; data: Trade }
  | { type: 'order_update'; userId: string; data: Order };

/** Client → Server messages */
export type WsClientMessage =
  | { type: 'subscribe'; symbol: string }
  | { type: 'unsubscribe'; symbol: string };
