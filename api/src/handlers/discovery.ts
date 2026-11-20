// Discovery run: collect -> deterministic filters -> Gemini -> alert.
// Invoked by EventBridge Scheduler (07:00 and 13:00, America/Sao_Paulo) and by
// the Owner Area's manual button. Idempotent: postings upsert on
// (source, externalId), only new or changed jobs are judged, discarded jobs
// leave a Fingerprint so they are never judged again, and a job is alerted at
// most once. Nothing here reads the whole table: retention is DynamoDB TTL and
// every read is a recent window, so a run costs the same forever. A lease in
// DynamoDB keeps a manual run and a scheduled one from overlapping (the
// account's concurrency limit of 10 rules out reserved concurrency).

import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../lib/db";
import { ensureVerifiedRecipient, sendAlerts } from "../discovery/alerts";
import { buildSources, collect } from "../discovery/collect";
import { evaluatePending } from "../discovery/evaluate";
import { geminiConfigFromEnv, geminiGenerateJson } from "../discovery/gemini";
import type { DiscoveredJob, Run } from "../discovery/model";
import { getSettings, SCORE_WINDOW_MS, scorePending, type ScoreStats } from "../discovery/score";
import { dynamoStore } from "../discovery/store";

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
  // Leave two minutes for alerts and the run log.
  const deadline = started + (context ? context.getRemainingTimeInMillis() : 14 * 60_000) - 120_000;
  const trigger = event.trigger === "manual" ? "manual" : "schedule";
  const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ msg, ...extra }));

  const settings = await getSettings(store);

  // 1-2. Collect every source, isolated, and upsert.
  const { run, touchedJobs } = await collect(store, await buildSources(store), trigger);
  log("collected", { newJobs: run.newJobs, touched: touchedJobs.length });

  // 3. Deterministic filters on new or changed jobs. Also picks up recent jobs
  // a previous run left unjudged if it died midway.
  const unjudged = new Map<string, DiscoveredJob>(touchedJobs.map((j) => [j.jobKey, j]));
  for (const job of await store.recentJobs(new Date(started - SCORE_WINDOW_MS))) {
    if (job.needsEvaluation && !unjudged.has(job.jobKey)) unjudged.set(job.jobKey, job);
  }
  const evaluated = await evaluatePending(store, [...unjudged.values()], settings.ownerYears);
  log("evaluated", { ...evaluated, jobs: undefined });

  // 4. Gemini: ambiguous LATAM + Work Nature score, in batches.
  const config = geminiConfigFromEnv();
  const scored: ScoreStats = config.apiKey
    ? await scorePending(store, geminiGenerateJson(config), config, { deadline })
    : { calls: 0, scored: 0, review: 0, discardedByLlm: 0, belowMinimum: 0, pending: 0, errors: ["GEMINI_API_KEY ausente"] };
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
      belowMinimum: scored.belowMinimum,
      pending: scored.pending,
      llmStoppedBy: scored.stoppedBy,
      llmErrors: scored.errors.length ? scored.errors : undefined,
      alertSkipped: alerts.skipped ?? alerts.error,
    },
  };
  await store.put(finished);
  log("done", { ms: Date.now() - started });
  return { ok: true, runId: finished.sk, newJobs: run.newJobs, llmCalls: scored.calls, alertsSent: alerts.sent };
}
