/**
 * InMemoryBroadcaster — uses Node's EventEmitter for pub/sub within a single
 * process. This is the default for local development and single-instance
 * deployments. No external dependencies required.
 *
 * LIMITATION: Messages published on one process are NOT visible to other
 * processes. For multi-instance deployments, use RedisBroadcaster instead.
 */

import EventEmitter from 'events';
import { Broadcaster } from './broadcaster.js';

export class InMemoryBroadcaster implements Broadcaster {
  private emitter = new EventEmitter();

  constructor() {
    // Raise the default listener limit since we'll have one listener per
    // subscribed symbol per connected WebSocket client.
    this.emitter.setMaxListeners(0);
  }

  publish(channel: string, message: object): void {
    this.emitter.emit(channel, message);
  }

  subscribe(channel: string, handler: (message: object) => void): void {
    this.emitter.on(channel, handler);
  }

  unsubscribe(channel: string, handler: (message: object) => void): void {
    this.emitter.off(channel, handler);
  }
}
