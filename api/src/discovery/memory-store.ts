// In-memory KeyValueStore for tests and dry runs. Same contract as the DynamoDB
// one; recentJobs reads publishedAt like the age index does.

import { DISC_JOB_PK, type DiscoveredJob } from "./model";
import type { KeyValueStore } from "./store";

export function memoryStore(seed: { pk: string; sk: string }[] = []) {
  const items = new Map<string, Record<string, unknown>>();
  const key = (pk: string, sk: string) => `${pk}|${sk}`;
  let writes = 0;
  for (const item of seed) items.set(key(item.pk, item.sk), structuredClone(item) as Record<string, unknown>);

  const store: KeyValueStore = {
    async get<T>(pk: string, sk: string) {
      const item = items.get(key(pk, sk));
      return item ? (structuredClone(item) as T) : undefined;
    },
    async put(item) {
      writes++;
      items.set(key(item.pk, item.sk), structuredClone(item) as Record<string, unknown>);
    },
    async delete(pk, sk) {
      writes++;
      items.delete(key(pk, sk));
    },
    async query<T>(pk: string, options: { newestFirst?: boolean; limit?: number } = {}) {
      const found = [...items.values()]
        .filter((i) => i.pk === pk)
        .sort((a, b) => String(a.sk).localeCompare(String(b.sk)));
      if (options.newestFirst) found.reverse();
      return structuredClone(options.limit ? found.slice(0, options.limit) : found) as T[];
    },
    async recentJobs(since) {
      return structuredClone(
        [...items.values()].filter(
          (i) => i.pk === DISC_JOB_PK && String(i.publishedAt) >= since.toISOString()
        )
      ) as unknown as DiscoveredJob[];
    },
  };

  return {
    store,
    items,
    writes: () => writes,
    get: (pk: string, sk: string) => items.get(key(pk, sk)),
    all: (pk: string) => [...items.values()].filter((i) => i.pk === pk),
  };
}
