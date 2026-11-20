import { runQueue, type GenerateJson, type GeminiConfig } from "./gemini";
import {
  applyJudgement,
  BATCH_RESPONSE_SCHEMA,
  buildBatchPrompt,
  splitBatchAnswer,
  type BatchItem,
} from "./judge";
import {
  DEFAULT_SETTINGS,
  DISC_JOBDESC_PK,
  DISC_SETTINGS_PK,
  DISC_SETTINGS_SK,
  type DiscoveredJob,
  type DiscoverySettings,
  type JobDescription,
} from "./model";
import { discardJob, type KeyValueStore } from "./store";

export const BATCH_SIZE = 8;
/** A job whose batches failed this many times goes to review instead of retrying forever. */
export const MAX_LLM_ATTEMPTS = 2;

export async function getSettings(store: KeyValueStore): Promise<DiscoverySettings> {
  const saved = await store.get<DiscoverySettings>(DISC_SETTINGS_PK, DISC_SETTINGS_SK);
  return {
    pk: DISC_SETTINGS_PK,
    sk: DISC_SETTINGS_SK,
    updatedAt: "",
    ...DEFAULT_SETTINGS,
    ...saved,
  };
}

/** Only jobs the panel can still show are worth a call: its widest window is 7 days. */
export const SCORE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Pending jobs, freshest first: when the quota runs short, today's jobs get scored. */
export async function pendingJobs(store: KeyValueStore, now = new Date()): Promise<DiscoveredJob[]> {
  const jobs = await store.recentJobs(new Date(now.getTime() - SCORE_WINDOW_MS));
  return jobs
    .filter((j) => j.llmStatus === "pending" && !j.discardReason && !j.needsEvaluation)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}

export interface ScoreStats {
  calls: number;
  scored: number;
  review: number;
  discardedByLlm: number;
  /** Scored below the Minimum Score: discarded. */
  belowMinimum: number;
  /** Jobs still pending after this run (cap, quota or a failed batch). */
  pending: number;
  stoppedBy?: "cap" | "quota";
  errors: string[];
}

function failedAttempt(job: DiscoveredJob, problem: string): DiscoveredJob {
  const attempts = (job.llmAttempts ?? 0) + 1;
  return attempts >= MAX_LLM_ATTEMPTS
    ? { ...job, llmAttempts: attempts, llmStatus: "review", reviewReason: problem }
    : { ...job, llmAttempts: attempts };
}

/**
 * Scores every pending job in batches of BATCH_SIZE, one Gemini request per
 * batch, sequential and spaced. Each entry of an answer is validated on its
 * own. Stops at the call cap, the daily quota or the deadline; whatever is
 * left stays pending for the next run.
 */
export async function scorePending(
  store: KeyValueStore,
  generate: GenerateJson,
  config: Pick<GeminiConfig, "intervalMs" | "maxCalls">,
  options: { deadline?: number; batchSize?: number; now?: Date } = {}
): Promise<ScoreStats> {
  const now = options.now ?? new Date();
  const settings = await getSettings(store);
  const jobs = await pendingJobs(store, now);
  const size = options.batchSize ?? BATCH_SIZE;
  const batches: DiscoveredJob[][] = [];
  for (let i = 0; i < jobs.length; i += size) batches.push(jobs.slice(i, i + size));

  const stats: ScoreStats = { calls: 0, scored: 0, review: 0, discardedByLlm: 0, belowMinimum: 0, pending: 0, errors: [] };

  const queue = await runQueue(
    batches,
    config,
    async (batch) => {
      const items: BatchItem[] = [];
      for (const [index, job] of batch.entries()) {
        const description = (await store.get<JobDescription>(DISC_JOBDESC_PK, job.jobKey))?.description ?? "";
        items.push({ id: `p${index + 1}`, job, description });
      }

      let raw: string;
      try {
        raw = await generate(buildBatchPrompt(items, settings.adherenceProfile), BATCH_RESPONSE_SCHEMA);
      } catch (error) {
        if ((error as Error).name === "QuotaExhausted") throw error;
        // Network or API error: nothing was judged, try again next run.
        stats.errors.push((error as Error).message.slice(0, 200));
        return;
      }

      const answers = splitBatchAnswer(raw);
      for (const item of items) {
        const entry = answers?.get(item.id);
        let next: DiscoveredJob;
        if (!answers) next = failedAttempt(item.job, "resposta do LLM não é JSON válido");
        else if (!entry) next = failedAttempt(item.job, "o LLM não devolveu resultado para esta vaga");
        else next = applyJudgement(item.job, item.description, entry).job;

        if (next.llmStatus === "review") stats.review++;

        // Discarded is gone: by the LLM (not tech, LATAM closed) or below the
        // Minimum Score. Deleted now; only the Fingerprint stays.
        const lowScore =
          next.llmStatus === "done" && !next.discardReason && (next.score ?? 0) < settings.minScore;
        if ((next.discardReason || lowScore) && next.triage !== "promoted") {
          if (lowScore) stats.belowMinimum++;
          else stats.discardedByLlm++;
          await discardJob(store, next.jobKey, now);
          continue;
        }
        if (next.llmStatus === "done") stats.scored++;
        await store.put(next);
      }
    },
    options.deadline
  );

  stats.calls = queue.calls;
  stats.stoppedBy = queue.stoppedBy;
  stats.pending = (await pendingJobs(store, now)).length;
  return stats;
}
