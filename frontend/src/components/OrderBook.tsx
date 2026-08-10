import { useMemo } from 'react';
import type { OrderBookSnapshot } from '../lib/types';

interface OrderBookProps {
  snapshot: OrderBookSnapshot | null;
}

export function OrderBook({ snapshot }: OrderBookProps) {
  const asks = useMemo(() => {
    if (!snapshot) return [];
    // Asks are naturally sorted lowest first, but for the ladder UI
    // we want the highest ask at the top and the lowest ask (best) at the bottom,
    // right above the spread. So we reverse them for display.
    return [...snapshot.asks].reverse();
  }, [snapshot]);

  const bids = snapshot?.bids || [];

  if (!snapshot) {
    return <div className="panel">Loading Order Book...</div>;
  }

  const bestAsk = asks[asks.length - 1]?.price;
  const bestBid = bids[0]?.price;
  const spread = (bestAsk && bestBid) ? (bestAsk - bestBid).toFixed(2) : '-';

  return (
    <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <h2 className="panel-title">Order Book ({snapshot.symbol})</h2>
      
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Price</th>
              <th>Quantity</th>
            </tr>
          </thead>
          <tbody>
            {asks.map((ask) => (
              <tr key={`ask-${ask.price}`} className="text-sell">
                <td>{ask.price.toFixed(2)}</td>
                <td>{ask.totalQuantity.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ textAlign: 'center', padding: '12px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '13px' }}>
          Spread: {spread}
        </div>

        <table className="data-table">
          <tbody>
            {bids.map((bid) => (
              <tr key={`bid-${bid.price}`} className="text-buy">
                <td>{bid.price.toFixed(2)}</td>
                <td>{bid.totalQuantity.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
