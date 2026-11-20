// Runs a real collection against every live source, storing into memory only.
// Nothing is written to DynamoDB. Useful to check a source after its API changes.
//
//   HIMALAYAS_API_KEY=... npx tsx api/scripts/collect-dry-run.ts

import { collect } from "../src/discovery/collect";
import { COMPANIES_SEED } from "../src/discovery/companies-seed";
import { himalayas } from "../src/discovery/sources/himalayas";
import { remotive } from "../src/discovery/sources/remotive";
import { remoteOk } from "../src/discovery/sources/remoteok";
import { weWorkRemotely } from "../src/discovery/sources/weworkremotely";
import { atsSource } from "../src/discovery/sources/ats";
import { DISC_JOB_PK, type DiscoveredJob, type Run } from "../src/discovery/model";
import type { KeyValueStore } from "../src/discovery/store";

const items = new Map<string, Record<string, unknown>>();
const store: KeyValueStore = {
  async get<T>(pk: string, sk: string) {
    return items.get(`${pk}|${sk}`) as T | undefined;
  },
  async put(item) {
    items.set(`${item.pk}|${item.sk}`, item as Record<string, unknown>);
  },
  async query<T>(pk: string) {
    return [...items.values()].filter((i) => i.pk === pk) as T[];
  },
};

async function main() {
  const sources = [
    himalayas(process.env.HIMALAYAS_API_KEY || undefined),
    remotive(),
    remoteOk(),
    weWorkRemotely(),
    ...COMPANIES_SEED.map(atsSource),
  ];
  const started = Date.now();
  const { run } = await collect(store, sources, "manual");
  const jobs = [...items.values()].filter((i) => i.pk === DISC_JOB_PK) as unknown as DiscoveredJob[];
  const multi = jobs.filter((j) => j.sources.length > 1);

  console.table(
    (run as Run).sources.map((s) => ({ source: s.source, fetched: s.fetched, errors: s.errors, ms: s.durationMs, error: s.errorMessages?.[0]?.slice(0, 60) }))
  );
  console.log(`jobs: ${jobs.length}, merged across sources: ${multi.length}, total ${Math.round((Date.now() - started) / 1000)}s`);
  for (const job of multi.slice(0, 5)) {
    console.log(`  ${job.company} | ${job.title} <- ${job.sources.map((s) => s.source).join(", ")}`);
  }

  // Second pass over the same data must write nothing new.
  const before = items.size;
  const again = await collect(store, sources, "manual");
  console.log(`second run: newJobs=${again.run.newJobs}, items ${before} -> ${items.size} (only the run log is new)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
