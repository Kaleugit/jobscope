import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../lib/db";
import { judgePosting, mergeIntoJob } from "./merge";
import {
  DISC_COMPANY_PK,
  DISC_JOB_PK,
  DISC_JOBDESC_PK,
  DISC_POSTING_PK,
  DISC_RUN_PK,
  postingSk,
  type Company,
  type DiscoveredJob,
  type JobDescription,
  type NormalizedJob,
  type Posting,
  type Run,
} from "./model";

/** The slice of DynamoDB the pipeline needs; tests pass an in-memory fake. */
export interface KeyValueStore {
  get<T>(pk: string, sk: string): Promise<T | undefined>;
  put<T extends { pk: string; sk: string }>(item: T): Promise<void>;
  query<T>(pk: string, options?: { skBeginsWith?: string; newestFirst?: boolean; limit?: number }): Promise<T[]>;
}

export const dynamoStore: KeyValueStore = {
  async get<T>(pk: string, sk: string) {
    const result = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk, sk } }));
    return result.Item as T | undefined;
  },
  async put(item) {
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  },
  async query<T>(pk: string, options: { skBeginsWith?: string; newestFirst?: boolean; limit?: number } = {}) {
    const items: T[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const result = await ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: options.skBeginsWith
            ? "pk = :pk AND begins_with(sk, :sk)"
            : "pk = :pk",
          ExpressionAttributeValues: options.skBeginsWith
            ? { ":pk": pk, ":sk": options.skBeginsWith }
            : { ":pk": pk },
          ScanIndexForward: !options.newestFirst,
          Limit: options.limit,
          ExclusiveStartKey: start,
        })
      );
      items.push(...((result.Items ?? []) as T[]));
      start = result.LastEvaluatedKey;
    } while (start && (!options.limit || items.length < options.limit));
    return options.limit ? items.slice(0, options.limit) : items;
  },
};

export interface UpsertStats {
  newPostings: number;
  newJobs: number;
  changedJobs: number;
  merged: number;
}

/**
 * Upserts a batch of normalized postings. Keyed by (source, externalId), so a
 * second run over the same data writes nothing new. Jobs touched in this batch
 * are cached, so two sources reporting the same job in one run merge cleanly.
 */
export async function upsertPostings(
  store: KeyValueStore,
  postings: NormalizedJob[],
  now: Date,
  jobCache = new Map<string, DiscoveredJob>()
): Promise<UpsertStats & { touchedJobs: DiscoveredJob[] }> {
  const stats: UpsertStats = { newPostings: 0, newJobs: 0, changedJobs: 0, merged: 0 };
  const touched = new Map<string, DiscoveredJob>();

  for (const posting of postings) {
    const existing = await store.get<Posting>(DISC_POSTING_PK, postingSk(posting.source, posting.externalId));
    const verdict = judgePosting(existing, posting, now);
    if (verdict.kind === "unchanged") continue;
    if (verdict.kind === "touch") {
      await store.put(verdict.posting);
      continue;
    }
    if (!existing) stats.newPostings++;

    const key = verdict.posting.jobKey;
    const current = jobCache.get(key) ?? (await store.get<DiscoveredJob>(DISC_JOB_PK, key));
    const result = mergeIntoJob(current, posting, verdict.descriptionChanged, now);

    if (result.isNew) stats.newJobs++;
    else if (result.descriptionChanged) stats.changedJobs++;
    else stats.merged++;

    if (result.descriptionChanged) {
      const description: JobDescription = { pk: DISC_JOBDESC_PK, sk: key, description: posting.description };
      await store.put(description);
    }
    await store.put(result.job);
    await store.put(verdict.posting);
    jobCache.set(key, result.job);
    touched.set(key, result.job);
  }

  return { ...stats, touchedJobs: [...touched.values()] };
}

export async function listCompanies(store: KeyValueStore): Promise<Company[]> {
  return store.query<Company>(DISC_COMPANY_PK);
}

export async function lastRun(store: KeyValueStore): Promise<Run | undefined> {
  const [run] = await store.query<Run>(DISC_RUN_PK, { newestFirst: true, limit: 1 });
  return run;
}
