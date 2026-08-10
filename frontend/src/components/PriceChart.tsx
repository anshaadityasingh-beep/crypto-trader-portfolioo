import { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import type { Trade } from '../lib/types';

interface PriceChartProps {
  trades: Trade[]; // Initial trade history + live updates
}

export function PriceChart({ trades }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#cbd5e1',
      },
      grid: {
        vertLines: { color: '#334155' },
        horzLines: { color: '#334155' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      width: chartContainerRef.current.clientWidth,
      height: 300,
    });

    // @ts-expect-error - Lightweight Charts typings may differ slightly depending on version
    const series = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Update chart data when trades arrive
  useEffect(() => {
    if (!seriesRef.current || trades.length === 0) return;

    // A very simplistic 1-minute bucket logic for demo purposes.
    // In a real app, backend would serve aggregated k-lines.
    const candles: Record<number, any> = {};

    // Sort trades chronologically
    const sorted = [...trades].sort((a, b) => a.executedAt - b.executedAt);

    sorted.forEach((trade) => {
      // Bucket by minute
      const bucketTime = Math.floor(trade.executedAt / 60000) * 60;
      if (!candles[bucketTime]) {
        candles[bucketTime] = {
          time: bucketTime as Time,
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
        };
      } else {
        const c = candles[bucketTime];
        c.high = Math.max(c.high, trade.price);
        c.low = Math.min(c.low, trade.price);
        c.close = trade.price;
      }
    });

    const data = Object.values(candles).sort((a: any, b: any) => (a.time as number) - (b.time as number));
    seriesRef.current.setData(data);

  }, [trades]);

  return (
    <div className="panel" style={{ flex: 1, borderBottom: '1px solid var(--border)', padding: 0 }}>
      <div style={{ padding: '16px' }}>
        <h2 className="panel-title">BTC-USD Chart</h2>
      </div>
      <div ref={chartContainerRef} style={{ width: '100%', height: '300px' }} />
    </div>
  );
}
