import { useEffect, useRef, useState, useCallback } from 'react';
import type { WsMessage, OrderBookSnapshot, Trade, Order } from '../lib/types';
import { useAuth } from './useAuth';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

export function useMarketSocket(symbol: string) {
  const { isAuthenticated } = useAuth();
  const ws = useRef<WebSocket | null>(null);
  
  const [snapshot, setSnapshot] = useState<OrderBookSnapshot | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [userOrders, setUserOrders] = useState<Record<string, Order>>({});
  const [isConnected, setIsConnected] = useState(false);
  
  // Reconnect logic
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(1000);

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return;

    let url = WS_URL;
    // For deployment (Module 8): if we are on https, force wss
    if (window.location.protocol === 'https:' && url.startsWith('ws://')) {
      url = url.replace('ws://', 'wss://');
    }

    const token = localStorage.getItem('token');
    if (token) {
      url += `?token=${token}`;
    }

    const socket = new WebSocket(url);
    ws.current = socket;

    socket.onopen = () => {
      setIsConnected(true);
      backoff.current = 1000; // reset backoff
      socket.send(JSON.stringify({ type: 'subscribe', symbol }));
    };

    socket.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data);
      
      switch (msg.type) {
        case 'snapshot':
        case 'book_update':
          if (msg.symbol === symbol) {
            setSnapshot(msg.data);
          }
          break;
        case 'trade':
          if (msg.symbol === symbol) {
            setTrades((prev) => [msg.data, ...prev].slice(0, 50)); // Keep last 50
          }
          break;
        case 'order_update':
          setUserOrders((prev) => ({
            ...prev,
            [msg.data.id]: msg.data
          }));
          break;
      }
    };

    socket.onclose = () => {
      setIsConnected(false);
      ws.current = null;
      // Reconnect with exponential backoff capped at 10s
      reconnectTimeout.current = setTimeout(() => {
        backoff.current = Math.min(backoff.current * 2, 10000);
        connect();
      }, backoff.current);
    };

  }, [symbol, isAuthenticated]); // Re-run if auth changes to send token

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [connect]);

  // Initial fetch for open orders when hook mounts
  useEffect(() => {
    if (isAuthenticated) {
      import('../lib/api').then(({ fetchApi }) => {
        fetchApi('/orders').then((orders: Order[]) => {
          const map: Record<string, Order> = {};
          orders.forEach(o => { map[o.id] = o; });
          setUserOrders(map);
        }).catch(err => console.error('Failed to load initial orders', err));
      });
    } else {
      setUserOrders({});
    }
  }, [isAuthenticated]);

  return { snapshot, trades, userOrders, isConnected };
}
