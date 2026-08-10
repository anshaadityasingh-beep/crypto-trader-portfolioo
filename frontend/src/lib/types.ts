// Mirrored from backend shared types

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'pending' | 'partially_filled' | 'filled' | 'cancelled';

export interface Order {
  id: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: number | null;
  quantity: number;
  filledQuantity: number;
  status: OrderStatus;
  createdAt: number;
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
  bids: { price: number; totalQuantity: number }[];
  asks: { price: number; totalQuantity: number }[];
}

export type WsMessage =
  | { type: 'snapshot'; symbol: string; data: OrderBookSnapshot }
  | { type: 'book_update'; symbol: string; data: OrderBookSnapshot }
  | { type: 'trade'; symbol: string; data: Trade }
  | { type: 'order_update'; userId: string; data: Order }
  | { type: 'error'; message: string };
