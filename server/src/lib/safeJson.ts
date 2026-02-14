/**
 * Safely parse JSON with a fallback value.
 * Unlike `JSON.parse(x || '[]')`, this handles corrupted/malformed data gracefully.
 */
export function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    console.warn('[safeJsonParse] Failed to parse:', value.slice(0, 100));
    return fallback;
  }
}
