# Real-Time Crypto Trading Engine

A full-stack, real-time cryptocurrency exchange engine built as a portfolio project. It features an in-memory matching engine (price-time priority), a WebSocket gateway for live order book and trade updates, a market maker bot for synthetic liquidity, and a modern React dashboard.

## Architecture

- **Backend:** Node.js, Express, TypeScript
- **Matching Engine:** Custom in-memory order book, synchronous matching for race-free execution
- **Database:** PostgreSQL (via Prisma ORM) for audit trails and startup reconciliation
- **Real-Time:** Raw WebSockets (`ws`) with JWT authentication
- **Scaling:** Pluggable Broadcaster interface (In-Memory for single-instance, Redis Pub/Sub for horizontal scaling)
- **Frontend:** React, Vite, TypeScript, Vanilla CSS, `lightweight-charts`

## Modules Implemented
- [x] Module 1: In-Memory Matching Engine
- [x] Module 2: Database & ORM
- [x] Module 3: REST API & Wiring
- [x] Module 4: WebSocket Gateway & Broadcaster
- [x] Module 5: Market Maker Bot
- [x] Module 6: Frontend Dashboard
- [x] Module 7: Load Testing (k6)
- [x] Module 8: Deployment (Render/Vercel)

## Deployment Instructions

### Backend (Render)
1. Push this repository to GitHub.
2. Create a new Web Service on Render, linked to the repo.
3. Use the `render.yaml` file (Infrastructure as Code) which configures the Docker build and start commands.
4. Set `DATABASE_URL` (e.g. from Supabase) and `JWT_SECRET` in the Render dashboard.

### Frontend (Vercel)
1. Import the `frontend` folder into Vercel.
2. Set `VITE_API_URL` and `VITE_WS_URL` to point to your Render backend URL.
3. Deploy.

## Local Development

```bash
# Backend
cd backend
npm install
npx prisma db push
npm run seed
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

For load testing, see `load-tests/README.md`.
