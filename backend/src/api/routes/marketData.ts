import { Router, Request, Response, NextFunction } from 'express';
import { getEngine } from '../../engine/index.js';
import { prisma } from '../../db/client.js';

const router = Router();

router.get('/orderbook/:symbol', (req: Request, res: Response, next: NextFunction) => {
  try {
    const symbol = req.params.symbol;
    const engine = getEngine(symbol);
    const snapshot = engine.getSnapshot();
    res.json(snapshot);
  } catch (error) {
    next(error);
  }
});

router.get('/trades/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const symbol = req.params.symbol;
    const trades = await prisma.trade.findMany({
      where: { symbol },
      orderBy: { executedAt: 'desc' },
      take: 50,
    });
    res.json(trades);
  } catch (error) {
    next(error);
  }
});

export default router;
