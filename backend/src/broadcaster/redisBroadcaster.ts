/**
 * RedisBroadcaster — uses Redis pub/sub (via ioredis) to relay messages across
 * multiple server instances. This is what enables horizontal scaling: when
 * instance A matches a trade and publishes a book_update, instances B and C
 * receive it via Redis and push it to their own WebSocket clients.
 *
 * ARCHITECTURE:
 *   ┌─────────┐  publish   ┌───────┐  subscribe  ┌─────────┐
 *   │ Server A │ ────────► │ Redis │ ───────────► │ Server B │
 *   └─────────┘            └───────┘              └─────────┘
 *       ▲                                              ▲
 *       │ ws clients                                   │ ws clients
 *
 * Redis pub/sub requires separate connections for subscribing and publishing.
 * ioredis handles this automatically when you use its `subscribe` method —
 * the client enters "subscriber mode" and can no longer issue regular commands.
 * We create two separate Redis clients to keep publish and subscribe independent.
 */

import Redis from 'ioredis';
import { Broadcaster } from './broadcaster.js';

export class RedisBroadcaster implements Broadcaster {
  private pub: Redis;
  private sub: Redis;
  private handlers = new Map<string, Set<(message: object) => void>>();

  constructor(redisUrl: string) {
    this.pub = new Redis(redisUrl);
    this.sub = new Redis(redisUrl);

    // Route incoming Redis messages to the registered handlers
    this.sub.on('message', (channel: string, rawMessage: string) => {
      const channelHandlers = this.handlers.get(channel);
      if (!channelHandlers) return;

      try {
        const message = JSON.parse(rawMessage);
        for (const handler of channelHandlers) {
          handler(message);
        }
      } catch (err) {
        console.error(`[RedisBroadcaster] Failed to parse message on channel ${channel}:`, err);
      }
    });

    this.pub.on('error', (err) => console.error('[RedisBroadcaster] pub error:', err));
    this.sub.on('error', (err) => console.error('[RedisBroadcaster] sub error:', err));

    console.log('[RedisBroadcaster] Connected to Redis for pub/sub');
  }

  publish(channel: string, message: object): void {
    this.pub.publish(channel, JSON.stringify(message));
  }

  subscribe(channel: string, handler: (message: object) => void): void {
    let channelHandlers = this.handlers.get(channel);
    if (!channelHandlers) {
      channelHandlers = new Set();
      this.handlers.set(channel, channelHandlers);
      // First handler for this channel — tell Redis to subscribe
      this.sub.subscribe(channel).catch((err) => {
        console.error(`[RedisBroadcaster] Failed to subscribe to ${channel}:`, err);
      });
    }
    channelHandlers.add(handler);
  }

  unsubscribe(channel: string, handler: (message: object) => void): void {
    const channelHandlers = this.handlers.get(channel);
    if (!channelHandlers) return;

    channelHandlers.delete(handler);
    if (channelHandlers.size === 0) {
      this.handlers.delete(channel);
      // No more handlers — tell Redis to unsubscribe from this channel
      this.sub.unsubscribe(channel).catch((err) => {
        console.error(`[RedisBroadcaster] Failed to unsubscribe from ${channel}:`, err);
      });
    }
  }
}
