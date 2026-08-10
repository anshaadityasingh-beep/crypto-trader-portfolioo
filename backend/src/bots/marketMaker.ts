import { prisma } from '../db/client.js';
import { getEngine } from '../engine/index.js';
import { orderEvents } from '../api/events.js';
import { PriceWalk, fetchInitialPrice } from './priceWalk.js';
import { Order, OrderSide, OrderType, OrderStatus } from '../types/index.js';
import { Prisma } from '@prisma/client';

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

// Configurable via environment variables
const TICK_MS = process.env.MARKET_MAKER_TICK_MS ? parseInt(process.env.MARKET_MAKER_TICK_MS, 10) : 2000;
const MAX_ORDERS = process.env.MARKET_MAKER_MAX_ORDERS ? parseInt(process.env.MARKET_MAKER_MAX_ORDERS, 10) : 50;

/**
 * Direct internal method to place orders, skipping HTTP overhead but keeping
 * identical semantics and broadcast triggers as the REST API.
 */
async function placeInternalOrder(userId: string, symbol: string, side: OrderSide, type: OrderType, price: number | null, quantity: number) {
  try {
    // 1. Persist the order to Postgres FIRST (status: pending)
    const newOrder = await prisma.order.create({
      data: {
        userId,
        symbol,
        side,
        type,
        price: price || null,
        quantity,
        status: 'pending',
        filledQuantity: 0,
      }
    });

    const engineOrder: Order = {
      id: newOrder.id,
      userId,
      symbol,
      side: side as OrderSide,
      type: type as OrderType,
      price: price,
      quantity: quantity,
      filledQuantity: 0,
      status: 'pending',
      createdAt: newOrder.createdAt.getTime(),
    };

    // 2. Call matchingEngine.submitOrder() synchronously
    const engine = getEngine(symbol);
    const trades = engine.submitOrder(engineOrder);

    // 3. Persist resulting trades and updated order statuses back to Postgres
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: engineOrder.id },
        data: {
          status: engineOrder.status as OrderStatus,
          filledQuantity: engineOrder.filledQuantity,
        }
      });

      for (const trade of trades) {
        await tx.trade.create({
          data: {
            id: trade.id,
            symbol: trade.symbol,
            price: trade.price,
            quantity: trade.quantity,
            buyOrderId: trade.buyOrderId,
            sellOrderId: trade.sellOrderId,
            executedAt: new Date(trade.executedAt),
          }
        });

        const opposingOrderId = trade.buyOrderId === engineOrder.id ? trade.sellOrderId : trade.buyOrderId;
        const opposingOrder = await tx.order.findUnique({ where: { id: opposingOrderId } });
        if (opposingOrder) {
          const newFilled = Number(opposingOrder.filledQuantity) + trade.quantity;
          const newStatus = newFilled >= Number(opposingOrder.quantity) ? 'filled' : 'partially_filled';
          
          await tx.order.update({
            where: { id: opposingOrderId },
            data: {
              filledQuantity: new Prisma.Decimal(newFilled),
              status: newStatus,
            }
          });

          orderEvents.emit('order_update', opposingOrder.userId, {
            id: opposingOrderId,
            userId: opposingOrder.userId,
            symbol,
            side: opposingOrder.side,
            type: opposingOrder.type,
            price: opposingOrder.price ? opposingOrder.price.toNumber() : null,
            quantity: opposingOrder.quantity.toNumber(),
            filledQuantity: newFilled,
            status: newStatus,
            createdAt: opposingOrder.createdAt.getTime(),
          });
        }
      }
    });

    // 4. Emit broadcasts
    orderEvents.emit('order_update', userId, engineOrder);
    if (trades.length > 0 || engineOrder.status === 'pending') {
       orderEvents.emit('book_update', symbol, engine.getSnapshot());
    }
    for (const trade of trades) {
       orderEvents.emit('trade', symbol, trade);
    }
    
    // Debug logging
    console.debug(`[bot] placed ${side.toUpperCase()} ${quantity} @ ${price ? price : 'MARKET'}`);

  } catch (err) {
    console.error('[bot] Error placing order:', err);
  }
}

async function tick(botUserId: string, symbol: string, priceWalk: PriceWalk) {
  if (!isRunning) return;

  const referencePrice = priceWalk.next();

  // Enforce MAX_ORDERS limit
  const openBotOrders = await prisma.order.findMany({
    where: { userId: botUserId, symbol, status: { in: ['pending', 'partially_filled'] } },
    orderBy: { createdAt: 'asc' },
  });

  if (openBotOrders.length > MAX_ORDERS) {
    const toCancel = openBotOrders.slice(0, openBotOrders.length - MAX_ORDERS);
    for (const order of toCancel) {
      const engine = getEngine(symbol);
      const success = engine.cancelOrder(order.id);
      if (success) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'cancelled' },
        });
        const updatedEngineOrder = {
          id: order.id,
          userId: order.userId,
          symbol: order.symbol,
          side: order.side as OrderSide,
          type: order.type as OrderType,
          price: order.price ? order.price.toNumber() : null,
          quantity: order.quantity.toNumber(),
          filledQuantity: order.filledQuantity.toNumber(),
          status: 'cancelled' as OrderStatus,
          createdAt: order.createdAt.getTime(),
        };
        orderEvents.emit('order_update', botUserId, updatedEngineOrder);
        orderEvents.emit('book_update', symbol, engine.getSnapshot());
      }
    }
  }

  // Generate 1-3 random orders
  const numOrders = Math.floor(Math.random() * 3) + 1;
  for (let i = 0; i < numOrders; i++) {
    const side: OrderSide = Math.random() > 0.5 ? 'buy' : 'sell';
    const type: OrderType = Math.random() > 0.8 ? 'market' : 'limit';
    
    let price: number | null = null;
    if (type === 'limit') {
      // price near reference price (+/- 0.5%)
      const spread = (Math.random() * 0.01) - 0.005;
      price = Math.round(referencePrice * (1 + spread) * 100) / 100;
    }

    // random quantity between 0.001 and 0.5
    const quantity = Math.round((Math.random() * 0.499 + 0.001) * 1000) / 1000;

    await placeInternalOrder(botUserId, symbol, side, type, price, quantity);
  }

  if (isRunning) {
    const jitter = Math.random() * 1000; // up to 1s random jitter
    timer = setTimeout(() => tick(botUserId, symbol, priceWalk), TICK_MS + jitter);
  }
}

export async function startMarketMaker(symbol: string) {
  if (isRunning) return;

  const botUser = await prisma.user.findFirst({
    where: { email: 'bot1@example.com' }
  });

  if (!botUser) {
    console.warn('[bot] Market maker bot user not found in DB. Did you run the seed script? Bot will not start.');
    return;
  }

  console.log(`[bot] Starting market maker for ${symbol}...`);
  isRunning = true;

  const initialPrice = await fetchInitialPrice(43000);
  const priceWalk = new PriceWalk(initialPrice);

  // Kick off the first tick
  tick(botUser.id, symbol, priceWalk);
}

export function stopMarketMaker() {
  if (!isRunning) return;
  console.log('[bot] Stopping market maker...');
  isRunning = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
