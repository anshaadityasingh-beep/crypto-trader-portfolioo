# Load Testing with k6

This directory contains load testing scripts for the real-time crypto trading engine. These scripts simulate realistic user behavior (concurrent order placement) and measure system throughput and broadcast latency.

## Prerequisites

You need `k6` installed locally. 
- **Mac (Homebrew):** `brew install k6`
- **Windows (Winget):** `winget install k6`
- **Linux:** See [k6 installation guide](https://k6.io/docs/get-started/installation/)

Ensure your backend server is running locally (e.g. `npm run dev` in the `/backend` folder), and that you have run the seed script so `test1@example.com` exists.

## Running Tests

You can run individual scripts:
```bash
k6 run order-placement.js
k6 run websocket-fanout.js
```

Or you can run the helper script to execute both and save the output:
```bash
./run-all.sh
```

## Important Note
Run these tests **against your local machine** (or a dedicated staging environment). Do not run these against a free-tier production deployment, as you could exhaust resources, violate terms of service, or experience artificially constrained performance.
