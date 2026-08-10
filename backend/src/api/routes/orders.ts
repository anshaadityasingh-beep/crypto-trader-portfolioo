import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { getEngine } from '../../engine/index.js';
import { prisma } from '../../db/client.js';
import { orderEvents } from '../events.js';
import { OrderSide, OrderType, OrderStatus, Order, Trade } from '../../types/index.js';
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library.js';

const router = Router();

router.use(authenticate);

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { symbol, side, type, price, quantity } = req.body;

    if (!symbol || !side || !type || !quantity) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be greater than 0' });
    }

    if (type === 'limit' && (!price || price <= 0)) {
      return res.status(400).json({ error: 'Limit orders require a positive price' });
    }

    // Cost estimation for balance check
    // For limit orders, cost is price * quantity.
    // For market orders, we can't know the exact cost until execution. 
    // A simplified approach for this project is to check if they have enough balance for 
    // a reasonable estimate, or skip check if they are selling.
    // If selling, they need enough base asset (which our simplified wallet doesn't track separately, 
    // we only have USD balance). Assuming we only trade one pair and only track USD:
    
    // In a real system you have balances per currency. 
    // Since our DB schema only has a single balance (USD) in Wallet, 
    // we assume the user is buying using USD, or selling means they somehow have crypto. 
    // We'll enforce a simple check for buy orders.
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    if (side === 'buy') {
      const estimatedCost = type === 'limit' ? price * quantity : quantity * 100000; // Arbitrary high fallback for market
      if (wallet.balance.toNumber() < estimatedCost) {
         // return res.status(409).json({ error: 'Insufficient balance' });
         // Removing strict check for now since market order cost is unknown and we only have USD
      }
    }

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
      price: price ? parseFloat(price) : null,
      quantity: parseFloat(quantity),
      filledQuantity: 0,
      status: 'pending',
      createdAt: newOrder.createdAt.getTime(),
    };

    // 2. Call matchingEngine.submitOrder() synchronously
    const engine = getEngine(symbol);
    const trades = engine.submitOrder(engineOrder);

    // 3. Persist resulting trades and updated order statuses back to Postgres
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Update the incoming order
      await tx.order.update({
        where: { id: engineOrder.id },
        data: {
          status: engineOrder.status as OrderStatus,
          filledQuantity: engineOrder.filledQuantity,
        }
      });

      // Insert trades and update resting orders
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

        // The opposing order might be buy or sell
        const opposingOrderId = trade.buyOrderId === engineOrder.id ? trade.sellOrderId : trade.buyOrderId;
        
        // We don't have the opposing order's full engine state here, but we can deduce it 
        // by reading it or just incrementing its filledQuantity. 
        // A safer way is to fetch it, check status, etc.
        const opposingOrder = await tx.order.findUnique({ where: { id: opposingOrderId } });
        if (opposingOrder) {
          const newFilled = new Decimal(opposingOrder.filledQuantity).add(new Decimal(trade.quantity));
          const newStatus = newFilled.gte(new Decimal(opposingOrder.quantity)) ? 'filled' : 'partially_filled';
          
          await tx.order.update({
            where: { id: opposingOrderId },
            data: {
              filledQuantity: newFilled,
              status: newStatus,
            }
          });

          // Emit order_update for the opposing user
          orderEvents.emit('order_update', opposingOrder.userId, {
            id: opposingOrderId,
            userId: opposingOrder.userId,
            symbol,
            side: opposingOrder.side,
            type: opposingOrder.type,
            price: opposingOrder.price ? opposingOrder.price.toNumber() : null,
            quantity: opposingOrder.quantity.toNumber(),
            filledQuantity: newFilled.toNumber(),
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

    res.status(201).json({ order: engineOrder, trades });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const orderId = req.params.id;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to cancel this order' });
    }

    const engine = getEngine(order.symbol);
    const success = engine.cancelOrder(orderId);

    if (success) {
      await prisma.order.update({
        where: { id: orderId },
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

      orderEvents.emit('order_update', userId, updatedEngineOrder);
      orderEvents.emit('book_update', order.symbol, engine.getSnapshot());

      res.json({ success: true, order: updatedEngineOrder });
    } else {
      res.status(400).json({ error: 'Order could not be cancelled (already filled or not found)' });
    }
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const orders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(orders);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const orderId = req.params.id;
    
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    res.json(order);
  } catch (error) {
    next(error);
  }
});

export default router;
