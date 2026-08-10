/**
 * PriceWalk — Manages a synthetic random-walk price for the market maker.
 *
 * This keeps the synthetic market moving organically around a starting price,
 * rather than jumping wildly.
 */

export class PriceWalk {
  private currentPrice: number;
  private maxStepPercent: number;

  constructor(initialPrice: number, maxStepPercent = 0.001) { // 0.1% max step default
    this.currentPrice = initialPrice;
    this.maxStepPercent = maxStepPercent;
  }

  /**
   * Get the next reference price, taking a small random walk from the previous price.
   */
  next(): number {
    // Random float between -maxStepPercent and +maxStepPercent
    const step = (Math.random() * 2 - 1) * this.maxStepPercent;
    
    // Apply step to current price
    this.currentPrice = this.currentPrice * (1 + step);
    
    // Round to 2 decimal places to simulate standard tick sizes
    this.currentPrice = Math.round(this.currentPrice * 100) / 100;
    
    return this.currentPrice;
  }

  getCurrent(): number {
    return this.currentPrice;
  }
}

/**
 * Fetch the real current BTC price from CoinGecko to seed the random walk.
 * Falls back to a hardcoded default if the fetch fails so we don't block startup.
 */
export async function fetchInitialPrice(defaultPrice = 43000): Promise<number> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000); // 2 second timeout

    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data: any = await res.json();
      if (data?.bitcoin?.usd) {
        console.log(`[PriceWalk] Seeded starting price from CoinGecko: $${data.bitcoin.usd}`);
        return data.bitcoin.usd;
      }
    }
  } catch (err) {
    console.warn(`[PriceWalk] Failed to fetch initial price, using fallback $${defaultPrice}:`, err);
  }
  
  return defaultPrice;
}
