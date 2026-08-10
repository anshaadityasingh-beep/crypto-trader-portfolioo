import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// Custom metrics
const placeOrderLatency = new Trend('place_order_latency');
const orderErrorRate = new Rate('order_error_rate');

export const options = {
  stages: [
    { duration: '10s', target: 50 }, // Ramp up to 50 users
    { duration: '30s', target: 50 }, // Sustain 50 users
    { duration: '10s', target: 0 },  // Ramp down to 0
  ],
  thresholds: {
    'place_order_latency': ['p(95)<200'], // 95% of orders should be placed in < 200ms
    'order_error_rate': ['rate<0.01'],    // < 1% error rate
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3001/api';
const SYMBOL = 'BTC-USD';
const REFERENCE_PRICE = 43000;

export function setup() {
  // Use a pre-seeded test user for all VUs to avoid auth bottleneck
  // In a real test, you might want each VU to have its own JWT.
  const payload = JSON.stringify({ email: 'test1@example.com', password: 'password1' });
  const params = { headers: { 'Content-Type': 'application/json' } };
  
  const res = http.post(`${BASE_URL}/auth/login`, payload, params);
  
  if (res.status !== 200) {
    throw new Error('Setup failed to authenticate test user. Did you run the seed script?');
  }

  return { token: res.json().token };
}

export default function (data) {
  const isBuy = Math.random() > 0.5;
  const spread = (Math.random() * 0.02) - 0.01; // +/- 1%
  const price = (REFERENCE_PRICE * (1 + spread)).toFixed(2);
  const quantity = (Math.random() * 0.1 + 0.01).toFixed(4);

  const payload = JSON.stringify({
    symbol: SYMBOL,
    side: isBuy ? 'buy' : 'sell',
    type: 'limit',
    price: Number(price),
    quantity: Number(quantity),
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${data.token}`
    }
  };

  const res = http.post(`${BASE_URL}/orders`, payload, params);

  const success = check(res, {
    'is status 201': (r) => r.status === 201,
  });

  placeOrderLatency.add(res.timings.duration);
  orderErrorRate.add(!success);

  // Control request rate per VU (~1 req/sec)
  sleep(1);
}
