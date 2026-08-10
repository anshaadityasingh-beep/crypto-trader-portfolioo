import { useState } from 'react';
import type { Order } from '../lib/types';
import { fetchApi } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

interface OpenOrdersProps {
  orders: Record<string, Order>;
}

export function OpenOrders({ orders }: OpenOrdersProps) {
  const { refreshBalance } = useAuth();
  const [cancelling, setCancelling] = useState<Record<string, boolean>>({});

  const openOrders = Object.values(orders)
    .filter(o => o.status === 'pending' || o.status === 'partially_filled')
    .sort((a, b) => b.createdAt - a.createdAt);

  const handleCancel = async (orderId: string) => {
    setCancelling(prev => ({ ...prev, [orderId]: true }));
    try {
      await fetchApi(`/orders/${orderId}`, { method: 'DELETE' });
      refreshBalance();
    } catch (err) {
      console.error('Failed to cancel order:', err);
    } finally {
      setCancelling(prev => ({ ...prev, [orderId]: false }));
    }
  };

  return (
    <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <h2 className="panel-title">Open Orders</h2>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Side</th>
              <th>Price</th>
              <th>Qty</th>
              <th>Filled</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {openOrders.map(order => (
              <tr key={order.id}>
                <td className={order.side === 'buy' ? 'text-buy' : 'text-sell'} style={{ textTransform: 'capitalize' }}>
                  {order.side}
                </td>
                <td>{order.price ? order.price.toFixed(2) : 'MKT'}</td>
                <td>{order.quantity.toFixed(4)}</td>
                <td>{(order.filledQuantity / order.quantity * 100).toFixed(0)}%</td>
                <td style={{ textAlign: 'right' }}>
                  <button 
                    onClick={() => handleCancel(order.id)}
                    disabled={cancelling[order.id]}
                    style={{ 
                      padding: '2px 8px', 
                      fontSize: '11px', 
                      width: 'auto', 
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            ))}
            {openOrders.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', paddingTop: '20px' }}>
                  No open orders
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
