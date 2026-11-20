import {
  DISC_JOB_PK,
  DISC_JOBS_GSI1PK,
  DISC_POSTING_PK,
  jobGsi1Sk,
  postingSk,
  type DiscoveredJob,
  type NormalizedJob,
  type Posting,
} from "./model";
import { descriptionHash, jobKeyFor } from "./text";

/** A posting seen again within this window is not rewritten just to bump lastSeenAt. */
export const TOUCH_INTERVAL_MS = 20 * 60 * 60 * 1000;

export type PostingVerdict =
  /** Same posting, same text, seen recently: nothing to write. */
  | { kind: "unchanged" }
  /** Same posting, same text: only lastSeenAt moves. */
  | { kind: "touch"; posting: Posting }
  /** New posting, or its description changed: the job must be merged. */
  | { kind: "merge"; posting: Posting; descriptionChanged: boolean };

export function judgePosting(
  existing: Posting | undefined,
  job: NormalizedJob,
  now: Date
): PostingVerdict {
  const hash = descriptionHash(job.description);
  const nowIso = now.toISOString();
  const key = jobKeyFor(job.company, job.title);

  if (!existing) {
    return {
      kind: "merge",
      descriptionChanged: true,
      posting: {
        pk: DISC_POSTING_PK,
        sk: postingSk(job.source, job.externalId),
        source: job.source,
        externalId: job.externalId,
        url: job.url,
        jobKey: key,
        descriptionHash: hash,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
      },
    };
  }

  // A retitled posting moves to another job key; treat it as a fresh merge.
  if (existing.descriptionHash !== hash || existing.jobKey !== key || existing.url !== job.url) {
    return {
      kind: "merge",
      descriptionChanged: existing.descriptionHash !== hash || existing.jobKey !== key,
      posting: { ...existing, url: job.url, jobKey: key, descriptionHash: hash, lastSeenAt: nowIso },
    };
  }

  if (now.getTime() - new Date(existing.lastSeenAt).getTime() < TOUCH_INTERVAL_MS) {
    return { kind: "unchanged" };
  }
  return { kind: "touch", posting: { ...existing, lastSeenAt: nowIso } };
}

export interface MergeResult {
  job: DiscoveredJob;
  isNew: boolean;
  /** The text the LLM reads changed: filters and score must run again. */
  descriptionChanged: boolean;
}

const sourceRef = (job: NormalizedJob) => `${job.source}#${job.externalId}`;

/**
 * Folds one posting into its Discovered Job. Postings of the same company and
 * title from any source land on the same job. The description belongs to the
 * first posting that brought the job; another source's version of the text only
 * adds that source, otherwise every run would flip the hash and re-score.
 */
export function mergeIntoJob(
  existing: DiscoveredJob | undefined,
  posting: NormalizedJob,
  postingDescriptionChanged: boolean,
  now: Date
): MergeResult {
  const nowIso = now.toISOString();
  const key = jobKeyFor(posting.company, posting.title);
  const hash = descriptionHash(posting.description);
  const ref = { source: posting.source, externalId: posting.externalId, url: posting.url };

  if (!existing) {
    const publishedAt = posting.publishedAt ?? nowIso;
    return {
      isNew: true,
      descriptionChanged: true,
      job: {
        pk: DISC_JOB_PK,
        sk: key,
        jobKey: key,
        gsi1pk: DISC_JOBS_GSI1PK,
        gsi1sk: jobGsi1Sk(publishedAt, key),
        company: posting.company,
        title: posting.title,
        locationRaw: posting.locationRaw,
        tags: posting.tags,
        salary: posting.salary,
        hints: posting.hints,
        publishedAt,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        sources: [ref],
        descriptionSource: sourceRef(posting),
        descriptionHash: hash,
        needsEvaluation: true,
        llmStatus: "pending",
        triage: "new",
        triageHistory: [{ triage: "new", at: nowIso }],
      },
    };
  }

  const job: DiscoveredJob = { ...existing, lastSeenAt: nowIso, expired: false };

  const index = job.sources.findIndex(
    (s) => s.source === ref.source && s.externalId === ref.externalId
  );
  job.sources =
    index === -1 ? [...job.sources, ref] : job.sources.map((s, i) => (i === index ? ref : s));

  // The job is as old as its earliest publication anywhere.
  if (posting.publishedAt && posting.publishedAt < job.publishedAt) {
    job.publishedAt = posting.publishedAt;
    job.gsi1sk = jobGsi1Sk(job.publishedAt, job.jobKey);
  }
  if (!job.salary && posting.salary) job.salary = posting.salary;
  job.tags = [...new Set([...job.tags, ...posting.tags])];
  job.hints = [...new Set([...job.hints, ...posting.hints])];

  const ownsDescription = job.descriptionSource === sourceRef(posting);
  const descriptionChanged = ownsDescription && postingDescriptionChanged && job.descriptionHash !== hash;
  if (descriptionChanged) {
    job.descriptionHash = hash;
    job.locationRaw = posting.locationRaw;
    job.needsEvaluation = true;
    job.llmStatus = "pending";
  }

  return { job, isNew: false, descriptionChanged };
}
