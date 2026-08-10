import EventEmitter from 'events';

// A shared event emitter for decoupling the REST API from the WebSocket module.
// The REST API will emit events here, and the WebSocket module (when implemented)
// will listen and broadcast them.

export const orderEvents = new EventEmitter();
