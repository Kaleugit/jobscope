import { atsSource } from "./sources/ats";
import { himalayas } from "./sources/himalayas";
import { remoteOk } from "./sources/remoteok";
import { remotive } from "./sources/remotive";
import { weWorkRemotely } from "./sources/weworkremotely";
import { DISC_RUN_PK, type DiscoveredJob, type Run, type Source, type SourceRunLog } from "./model";
import { lastRun, listCompanies, upsertPostings, type KeyValueStore } from "./store";

/** First run looks back this far: the panel's widest window is 48h. */
export const FIRST_RUN_LOOKBACK_MS = 48 * 60 * 60 * 1000;
/** Later runs overlap the previous one by a day, for sources that publish late (Remotive). */
export const OVERLAP_MS = 24 * 60 * 60 * 1000;

export async function buildSources(store: KeyValueStore): Promise<Source[]> {
  const companies = (await listCompanies(store)).filter((c) => c.active);
  return [
    himalayas(process.env.HIMALAYAS_API_KEY || undefined),
    remotive(),
    remoteOk(),
    weWorkRemotely(),
    ...companies.map(atsSource),
  ];
}

export interface CollectResult {
  run: Run;
  touchedJobs: DiscoveredJob[];
}

/**
 * Fetches every source with its failure isolated (one source down never stops
 * the others), then upserts what came back. Logs per source.
 */
export async function collect(
  store: KeyValueStore,
  sources: Source[],
  trigger: Run["trigger"],
  now = new Date()
): Promise<CollectResult> {
  const previous = await lastRun(store);
  const since = previous
    ? new Date(new Date(previous.startedAt).getTime() - OVERLAP_MS)
    : new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);

  const fetched = await Promise.all(
    sources.map(async (source) => {
      const started = Date.now();
      try {
        const jobs = await source.fetchJobs({ since });
        return { source, jobs, error: undefined as string | undefined, ms: Date.now() - started };
      } catch (error) {
        return { source, jobs: [], error: (error as Error).message, ms: Date.now() - started };
      }
    })
  );

  const logs: SourceRunLog[] = [];
  const touched = new Map<string, DiscoveredJob>();
  const jobCache = new Map<string, DiscoveredJob>();
  let newJobs = 0;

  for (const { source, jobs, error, ms } of fetched) {
    let errors = error ? 1 : 0;
    const errorMessages = error ? [error] : [];
    try {
      const result = await upsertPostings(store, jobs, now, jobCache);
      newJobs += result.newJobs;
      for (const job of result.touchedJobs) touched.set(job.jobKey, job);
    } catch (storeError) {
      errors++;
      errorMessages.push(`store: ${(storeError as Error).message}`);
    }
    logs.push({
      source: source.id,
      fetched: jobs.length,
      errors,
      errorMessages: errorMessages.length ? errorMessages : undefined,
      durationMs: ms,
    });
    console.log(JSON.stringify({ msg: "source", source: source.id, fetched: jobs.length, errors, ms }));
  }

  const run: Run = {
    pk: DISC_RUN_PK,
    sk: now.toISOString(),
    trigger,
    startedAt: now.toISOString(),
    finishedAt: new Date().toISOString(),
    sources: logs,
    newJobs,
    llmCalls: 0,
    alertsSent: 0,
  };
  await store.put(run);
  return { run, touchedJobs: [...touched.values()] };
}
