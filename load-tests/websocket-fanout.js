import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import exec from 'k6/execution';

const broadcastLatency = new Trend('websocket_broadcast_latency');

export const options = {
  scenarios: {
    // Scenario 1: Idle WebSocket listeners (subscribers)
    listeners: {
      executor: 'constant-vus',
      vus: 100,
      duration: '30s',
      exec: 'listener',
    },
    // Scenario 2: Active traders generating events
    traders: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 10,
      exec: 'trader',
      startTime: '5s', // Wait for listeners to connect
    }
  },
  thresholds: {
    'websocket_broadcast_latency': ['p(95)<100'], // Broadcasts should reach listeners in < 100ms
  }
};

const WS_URL = __ENV.WS_URL || 'ws://localhost:3001';
const API_URL = __ENV.API_URL || 'http://localhost:3001/api';
const SYMBOL = 'BTC-USD';

export function setup() {
  const payload = JSON.stringify({ email: 'test1@example.com', password: 'password1' });
  const params = { headers: { 'Content-Type': 'application/json' } };
  const res = http.post(`${API_URL}/auth/login`, payload, params);
  
  if (res.status !== 200) {
    throw new Error('Setup failed to authenticate test user.');
  }

  return { token: res.json().token };
}

// ---------------------------------------------------------------------------
// Listener Scenario: Connects to WS and waits for messages
// ---------------------------------------------------------------------------
export function listener() {
  const url = `${WS_URL}`;
  
  const res = ws.connect(url, function (socket) {
    socket.on('open', function () {
      socket.send(JSON.stringify({ type: 'subscribe', symbol: SYMBOL }));
    });

    socket.on('message', function (msg) {
      const data = JSON.parse(msg);
      
      if (data.type === 'trade') {
        // Since backend and k6 run on the same machine for this test,
        // their clocks are synchronized. We can use the executedAt timestamp
        // created by the matching engine to measure full-stack latency.
        const executedAt = new Date(data.data.executedAt).getTime();
        const latency = Date.now() - executedAt;
        
        // Filter out old trades that were loaded from DB
        if (latency > 0 && latency < 5000) {
            broadcastLatency.add(latency);
        }
      }
    });

    socket.setTimeout(function () {
      socket.close();
    }, 30000);
  });

  check(res, { 'status is 101': (r) => r && r.status === 101 });
}

// ---------------------------------------------------------------------------
// Trader Scenario: Generates guaranteed matches to trigger broadcasts
// ---------------------------------------------------------------------------
export function trader(data) {
  // To ensure a match and a trade broadcast, we place a market buy order
  // (Assuming the market maker bot is running and providing liquidity)
  
  const now = Date.now();
  // Hack: Encode timestamp into price so listeners can extract it to measure latency
  // e.g., 43000.1705678901234 -> we don't actually care about the limit price
  // since we will just send market orders, but the matching engine trades at the resting price.
  // Instead, since we can't easily modify the backend Trade schema to include a 'traceId', 
  // we just rely on the executedAt timestamp of the trade if the backend clock is same as k6 clock.
  
  // Wait, if k6 and backend are on the same machine (localhost), Date.now() is perfectly synchronized.
  // We can just use the Trade.executedAt timestamp added by the backend engine!
  // BUT the listener is already checking if (data.type === 'trade') in the message loop above. Let's fix that.
  
  const payload = JSON.stringify({
    symbol: SYMBOL,
    side: Math.random() > 0.5 ? 'buy' : 'sell',
    type: 'market',
    quantity: 0.01,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${data.token}`
    }
  };

  http.post(`${API_URL}/orders`, payload, params);
}
