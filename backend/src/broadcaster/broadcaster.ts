/**
 * Broadcaster interface — abstracts pub/sub so the WebSocket gateway doesn't
 * care whether messages are routed in-process (InMemoryBroadcaster) or across
 * multiple server instances (RedisBroadcaster).
 *
 * WHY AN INTERFACE:
 * In a single-process deployment the in-memory implementation is sufficient.
 * But if you horizontally scale to N backend instances behind a load balancer,
 * a WebSocket client connected to instance A won't receive a trade that was
 * matched on instance B — unless there's a shared pub/sub bus (Redis) that
 * relays messages across instances. This interface lets the rest of the code
 * stay identical regardless of which implementation is active.
 *
 * The implementation is selected at startup based on the REDIS_URL env var.
 */

export interface Broadcaster {
  /**
   * Publish a message to a named channel.
   * All subscribers of that channel (potentially on other server instances)
   * will receive the message.
   */
  publish(channel: string, message: object): void;

  /**
   * Subscribe to a named channel.
   * The handler fires every time a message is published to that channel.
   */
  subscribe(channel: string, handler: (message: object) => void): void;

  /**
   * Unsubscribe a handler from a channel (optional cleanup).
   */
  unsubscribe(channel: string, handler: (message: object) => void): void;
}
