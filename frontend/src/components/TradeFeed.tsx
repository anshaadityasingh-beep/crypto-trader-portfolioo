import { useState, useEffect } from 'react';
import type { Trade } from '../lib/types';

interface TradeFeedProps {
  trades: Trade[];
}

export function TradeFeed({ trades }: TradeFeedProps) {
  const [flashStates, setFlashStates] = useState<Record<string, string>>({});

  useEffect(() => {
    // Flash new trades when they arrive
    if (trades.length > 0) {
      const latest = trades[0];
      const type = Math.random() > 0.5 ? 'buy' : 'sell'; // Ideally derived from taker side, mocking for UI
      
      setFlashStates((prev) => ({
        ...prev,
        [latest.id]: `flash-${type}`
      }));

      // Cleanup flash class after animation
      const timer = setTimeout(() => {
        setFlashStates((prev) => {
          const next = { ...prev };
          delete next[latest.id];
          return next;
        });
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [trades]);

  return (
    <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <h2 className="panel-title">Recent Trades</h2>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Price</th>
              <th>Quantity</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => {
              const date = new Date(trade.executedAt);
              const time = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
              
              return (
                <tr key={trade.id} className={flashStates[trade.id] || ''}>
                  <td>{trade.price.toFixed(2)}</td>
                  <td>{trade.quantity.toFixed(4)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{time}</td>
                </tr>
              );
            })}
            {trades.length === 0 && (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', paddingTop: '20px' }}>
                  No trades yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
