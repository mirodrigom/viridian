/**
 * Safely parse JSON with a fallback value.
 * Unlike `JSON.parse(x || '[]')`, this handles corrupted/malformed data gracefully.
 */
import { createLogger } from '../logger.js';

const log = createLogger('safeJson');

export function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    log.warn({ preview: value.slice(0, 100) }, 'Failed to parse JSON');
    return fallback;
  }
}
