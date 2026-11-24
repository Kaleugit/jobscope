// Runs a real collection against every live source, storing into memory only.
// Nothing is written to DynamoDB. Useful to check a source after its API changes.
//
//   HIMALAYAS_API_KEY=... REBASE_API_TOKEN=... npx tsx api/scripts/collect-dry-run.ts

import { collect } from "../src/discovery/collect";
import { COMPANIES_SEED } from "../src/discovery/companies-seed";
import { himalayas } from "../src/discovery/sources/himalayas";
import { remotive } from "../src/discovery/sources/remotive";
import { remoteOk } from "../src/discovery/sources/remoteok";
import { atsSource } from "../src/discovery/sources/ats";
import { fourDayWeek } from "../src/discovery/sources/fourdayweek";
import { rebase } from "../src/discovery/sources/rebase";
import { DISC_JOB_PK, type DiscoveredJob, type Run } from "../src/discovery/model";
import { memoryStore } from "../src/discovery/memory-store";

const { store, items } = memoryStore();

async function main() {
  const sources = [
    himalayas(process.env.HIMALAYAS_API_KEY || undefined),
    remotive(),
    remoteOk(),
    rebase(process.env.REBASE_API_TOKEN || undefined),
    fourDayWeek(),
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
