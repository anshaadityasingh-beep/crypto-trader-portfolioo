#!/bin/bash
# run-all.sh - Execute all load tests and save results

mkdir -p results

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

echo "Running REST Order Placement Load Test..."
k6 run order-placement.js > results/order-placement_${TIMESTAMP}.log
echo "Finished Order Placement Test. Results saved to results/order-placement_${TIMESTAMP}.log"

echo ""
echo "Running WebSocket Fan-out Load Test..."
k6 run websocket-fanout.js > results/websocket-fanout_${TIMESTAMP}.log
echo "Finished WebSocket Fan-out Test. Results saved to results/websocket-fanout_${TIMESTAMP}.log"

echo ""
echo "All tests complete!"
