# Build stage
FROM node:20-alpine AS builder

WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY tsconfig.json ./
COPY src ./src/
RUN npm run build
RUN npx prisma generate

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --only=production

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# We need the migration script to run on startup.
# Render lets us specify a start command, but we can also use a small entrypoint script.
# Run migrations on startup before booting the server
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/server.js"]
