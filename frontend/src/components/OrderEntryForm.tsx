import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { fetchApi } from '../lib/api';

export function OrderEntryForm({ symbol }: { symbol: string }) {
  const { balance, refreshBalance } = useAuth();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'limit' | 'market'>('limit');
  const [price, setPrice] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    try {
      await fetchApi('/orders', {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          side,
          type,
          price: type === 'limit' ? Number(price) : null,
          quantity: Number(quantity),
        }),
      });
      setMessage({ type: 'success', text: 'Order placed successfully!' });
      setQuantity('');
      refreshBalance();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to place order' });
    }
  };

  return (
    <div className="panel">
      <h2 className="panel-title">Place Order</h2>
      
      <div style={{ marginBottom: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
        Available Balance: <strong>${balance.toFixed(2)}</strong>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <button
            type="button"
            className={side === 'buy' ? 'btn-buy' : ''}
            style={{ background: side === 'buy' ? 'var(--buy)' : 'var(--bg-tertiary)' }}
            onClick={() => setSide('buy')}
          >
            Buy
          </button>
          <button
            type="button"
            className={side === 'sell' ? 'btn-sell' : ''}
            style={{ background: side === 'sell' ? 'var(--sell)' : 'var(--bg-tertiary)' }}
            onClick={() => setSide('sell')}
          >
            Sell
          </button>
        </div>

        <div className="input-group">
          <label>Order Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as 'limit' | 'market')}>
            <option value="limit">Limit</option>
            <option value="market">Market</option>
          </select>
        </div>

        <div className="input-group">
          <label>Quantity</label>
          <input
            type="number"
            step="0.0001"
            required
            min="0.0001"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0.00"
          />
        </div>

        <div className="input-group">
          <label>Price</label>
          <input
            type="number"
            step="0.01"
            required={type === 'limit'}
            disabled={type === 'market'}
            min="0.01"
            value={type === 'limit' ? price : ''}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={type === 'market' ? 'Market Price' : '0.00'}
          />
        </div>

        <button type="submit" className={side === 'buy' ? 'btn-buy' : 'btn-sell'} style={{ marginTop: '8px' }}>
          {side === 'buy' ? 'Buy' : 'Sell'} {symbol.split('-')[0]}
        </button>

        {message && (
          <div style={{ marginTop: '12px', fontSize: '13px', color: message.type === 'success' ? 'var(--buy)' : 'var(--sell)' }}>
            {message.text}
          </div>
        )}
      </form>
    </div>
  );
}
