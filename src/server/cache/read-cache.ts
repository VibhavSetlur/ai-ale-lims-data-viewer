/**
 * Tiny in-process read-through cache for expensive, deterministic scientific
 * dataset reads. The store is a bounded insertion-ordered Map, so when it grows
 * past MAX we evict the oldest inserted entry (approximate LRU by insertion).
 * Values are cached by an opaque string key the caller builds from the snapshot
 * id, route id, and a stable serialization of the query object.
 */

type Entry = { value: unknown; expires: number };

const store = new Map<string, Entry>();
const MAX = 200;

export function cached<T>(key: string, ttlMs: number, produce: () => T): T {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  const value = produce();
  store.set(key, { value, expires: now + ttlMs });
  if (store.size > MAX) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  return value;
}

/**
 * Deterministic JSON serialization: object keys are sorted recursively so two
 * query objects with the same content always produce the same cache key
 * regardless of key insertion order. Arrays keep their order. Non-plain values
 * fall back to JSON.stringify semantics.
 */
export function stableStringify(input: unknown): string {
  return JSON.stringify(normalize(input));
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalize);
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) out[key] = normalize(source[key]);
  return out;
}
