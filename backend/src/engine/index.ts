import { MatchingEngine } from './matchingEngine.js';

const engines = new Map<string, MatchingEngine>();

export function getEngine(symbol: string): MatchingEngine {
  let engine = engines.get(symbol);
  if (!engine) {
    engine = new MatchingEngine(symbol);
    engines.set(symbol, engine);
  }
  return engine;
}
