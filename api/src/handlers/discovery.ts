// Discovery run: collect -> deterministic filters -> Gemini -> alert -> expire.
// Invoked by EventBridge Scheduler (07:00 and 13:00, America/Sao_Paulo) and by
// the Owner Area's manual button. Idempotent: postings upsert on
// (source, externalId), only new or changed jobs are judged, and a job is
// alerted at most once. A lease in DynamoDB keeps a manual run and a scheduled
// one from overlapping (the account's concurrency limit of 10 rules out
// reserved concurrency).

import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../lib/db";
import { ensureVerifiedRecipient, sendAlerts } from "../discovery/alerts";
import { buildSources, collect } from "../discovery/collect";
import { evaluatePending } from "../discovery/evaluate";
import { geminiConfigFromEnv, geminiGenerateJson } from "../discovery/gemini";
import { DISC_JOB_PK, type DiscoveredJob, type Run } from "../discovery/model";
import { getSettings, scorePending } from "../discovery/score";
import { dynamoStore, type KeyValueStore } from "../discovery/store";

/** A job absent from every source this long is probably filled or closed. */
export const EXPIRE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export async function expireStale(store: KeyValueStore, now: Date): Promise<number> {
  let expired = 0;
  for (const job of await store.query<DiscoveredJob>(DISC_JOB_PK)) {
    if (job.expired || job.triage === "promoted") continue;
    if (now.getTime() - new Date(job.lastSeenAt).getTime() < EXPIRE_AFTER_MS) continue;
    await store.put({ ...job, expired: true });
    expired++;
  }
  return expired;
}

const LOCK_KEY = { pk: "DISC#LOCK", sk: "RUN" };
/** Longer than the Lambda's 15 minutes, so a crashed run's lease always lapses. */
const LEASE_MS = 16 * 60_000;

async function acquireLease(now: number): Promise<boolean> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { ...LOCK_KEY, expiresAt: now + LEASE_MS },
        ConditionExpression: "attribute_not_exists(pk) OR expiresAt < :now",
        ExpressionAttributeValues: { ":now": now },
      })
    );
    return true;
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") return false;
    throw error;
  }
}

const releaseLease = () => ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: LOCK_KEY }));

export interface DiscoveryEvent {
  trigger?: Run["trigger"];
}

export async function handler(event: DiscoveryEvent = {}, context?: { getRemainingTimeInMillis(): number }) {
  const started = Date.now();
  if (!(await acquireLease(started))) {
    console.log(JSON.stringify({ msg: "skipped: another run holds the lease" }));
    return { ok: false, skipped: "another run is in progress" };
  }
  try {
    return await runDiscovery(event, started, context);
  } finally {
    await releaseLease();
  }
}

async function runDiscovery(event: DiscoveryEvent, started: number, context?: { getRemainingTimeInMillis(): number }) {
  const store = dynamoStore;
  // Leave two minutes for alerts, expiry and the run log.
  const deadline = started + (context ? context.getRemainingTimeInMillis() : 14 * 60_000) - 120_000;
  const trigger = event.trigger === "manual" ? "manual" : "schedule";
  const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ msg, ...extra }));

  const settings = await getSettings(store);

  // 1-2. Collect every source, isolated, and upsert.
  const { run, touchedJobs } = await collect(store, await buildSources(store), trigger);
  log("collected", { newJobs: run.newJobs, touched: touchedJobs.length });

  // 3. Deterministic filters on new or changed jobs, including any left
  // unjudged by an earlier run that died midway.
  const unjudged = (await store.query<DiscoveredJob>(DISC_JOB_PK)).filter((j) => j.needsEvaluation);
  const evaluated = await evaluatePending(store, unjudged, settings.ownerYears);
  log("evaluated", { ...evaluated, jobs: undefined });

  // 4. Gemini: ambiguous LATAM + Work Nature score, in batches.
  const config = geminiConfigFromEnv();
  const scored = config.apiKey
    ? await scorePending(store, geminiGenerateJson(config), config, { deadline })
    : { calls: 0, scored: 0, review: 0, discardedByLlm: 0, pending: 0, errors: ["GEMINI_API_KEY ausente"] };
  log("scored", { ...scored, model: config.model });

  // 5. Alert: one e-mail at most. Verification runs every time, so a new
  // address gets its confirmation mail on the first run after it is set.
  let alerts: { sent: number; skipped?: string; error?: string } = { sent: 0 };
  try {
    await ensureVerifiedRecipient(store, settings);
    alerts = await sendAlerts(store, await getSettings(store));
  } catch (error) {
    alerts = { sent: 0, error: (error as Error).message.slice(0, 200) };
  }
  log("alerts", alerts);

  // 6. Expire jobs gone from every source for 30 days.
  const expired = await expireStale(store, new Date());

  const finished: Run = {
    ...run,
    finishedAt: new Date().toISOString(),
    llmCalls: scored.calls,
    alertsSent: alerts.sent,
    evaluation: {
      evaluated: evaluated.evaluated,
      discardedByRules: evaluated.discarded,
      scored: scored.scored,
      review: scored.review,
      discardedByLlm: scored.discardedByLlm,
      pending: scored.pending,
      llmStoppedBy: scored.stoppedBy,
      llmErrors: scored.errors.length ? scored.errors : undefined,
      alertSkipped: alerts.skipped ?? alerts.error,
      expired,
    },
  };
  await store.put(finished);
  log("done", { ms: Date.now() - started });
  return { ok: true, runId: finished.sk, newJobs: run.newJobs, llmCalls: scored.calls, alertsSent: alerts.sent };
}
