import { describe, expect, it } from "vitest";
import { TOUCH_INTERVAL_MS } from "../src/discovery/merge";
import { DISC_JOB_PK, DISC_POSTING_PK, type DiscoveredJob, type NormalizedJob } from "../src/discovery/model";
import { memoryStore as sharedMemoryStore } from "../src/discovery/memory-store";
import { discardJob, upsertPostings } from "../src/discovery/store";

function memoryStore() {
  const m = sharedMemoryStore();
  return {
    ...m,
    jobs: () => m.all(DISC_JOB_PK) as unknown as DiscoveredJob[],
    postings: () => m.all(DISC_POSTING_PK),
  };
}

const base: NormalizedJob = {
  source: "himalayas",
  externalId: "h-1",
  url: "https://himalayas.app/companies/acme/jobs/backend",
  company: "Acme",
  title: "Backend Engineer (Remote)",
  description: "Build APIs. Open to candidates in Latin America.",
  locationRaw: "Worldwide",
  tags: ["Developer"],
  publishedAt: "2026-11-20T10:00:00.000Z",
  hints: ["location:Worldwide"],
};

const now = new Date("2026-11-20T12:00:00.000Z");

describe("upsert", () => {
  it("is idempotent: the same batch twice creates nothing new", async () => {
    const db = memoryStore();
    const first = await upsertPostings(db.store, [base], now);
    expect(first.newJobs).toBe(1);
    const writesAfterFirst = db.writes();

    const second = await upsertPostings(db.store, [base], new Date(now.getTime() + 60_000));
    expect(second.newJobs).toBe(0);
    expect(second.newPostings).toBe(0);
    expect(db.writes()).toBe(writesAfterFirst);
    expect(db.jobs()).toHaveLength(1);
  });

  it("only bumps lastSeenAt once the touch interval has passed", async () => {
    const db = memoryStore();
    await upsertPostings(db.store, [base], now);
    const later = new Date(now.getTime() + TOUCH_INTERVAL_MS + 1);
    await upsertPostings(db.store, [base], later);
    expect(db.postings()[0].lastSeenAt).toBe(later.toISOString());
  });

  it("merges the same job from two sources into one, keeping both", async () => {
    const db = memoryStore();
    const fromWwr: NormalizedJob = {
      ...base,
      source: "remoteok",
      externalId: "rok-77",
      url: "https://remoteok.com/remote-jobs/acme-backend",
      company: "ACME Inc.",
      title: "Backend Engineer - LATAM",
      description: "A different write-up of the same job.",
      publishedAt: "2026-11-20T08:00:00.000Z",
      hints: ["region:Latin America Only"],
    };
    const result = await upsertPostings(db.store, [base, fromWwr], now);

    expect(result.newJobs).toBe(1);
    expect(db.jobs()).toHaveLength(1);
    const [job] = db.jobs();
    expect(job.sources.map((s) => s.source).sort()).toEqual(["himalayas", "remoteok"]);
    // Age comes from the earliest publication anywhere.
    expect(job.publishedAt).toBe("2026-11-20T08:00:00.000Z");
    expect(job.gsi1sk.startsWith("2026-11-20T08:00:00.000Z#")).toBe(true);
    expect(job.hints).toEqual(expect.arrayContaining(["location:Worldwide", "region:Latin America Only"]));
  });

  it("does not re-evaluate when a second source has different text", async () => {
    const db = memoryStore();
    await upsertPostings(db.store, [base], now);
    const evaluated = { ...db.jobs()[0], needsEvaluation: false, llmStatus: "done" as const };
    await db.store.put(evaluated);

    const other: NormalizedJob = { ...base, source: "remotive", externalId: "r-9", description: "Other text." };
    await upsertPostings(db.store, [other], now);

    const [job] = db.jobs();
    expect(job.needsEvaluation).toBe(false);
    expect(job.sources).toHaveLength(2);
  });

  it("re-evaluates when the owning source changes the description", async () => {
    const db = memoryStore();
    await upsertPostings(db.store, [base], now);
    const evaluated: DiscoveredJob = { ...db.jobs()[0], needsEvaluation: false, llmStatus: "done" };
    await db.store.put(evaluated);

    const edited = { ...base, description: "Build APIs. US only." };
    const result = await upsertPostings(db.store, [edited], new Date(now.getTime() + 60_000));

    expect(result.changedJobs).toBe(1);
    const [job] = db.jobs();
    expect(job.needsEvaluation).toBe(true);
    expect(job.llmStatus).toBe("pending");
    const description = db.items.get(`DISC#JOBDESC|${job.jobKey}`);
    expect(description?.description).toBe("Build APIs. US only.");
  });

  it("falls back to first-seen time when the source has no publication date", async () => {
    const db = memoryStore();
    await upsertPostings(db.store, [{ ...base, publishedAt: undefined }], now);
    expect(db.jobs()[0].publishedAt).toBe(now.toISOString());
  });

  it("gives an undecided job a 30-day expiry from publication", async () => {
    const db = memoryStore();
    await upsertPostings(db.store, [base], now);
    const expected = Math.floor(new Date(base.publishedAt!).getTime() / 1000) + 30 * 24 * 3600;
    expect(db.jobs()[0].ttl).toBe(expected);
  });

  describe("fingerprints", () => {
    it("a discarded job is never judged again, from any source", async () => {
      const db = memoryStore();
      const first = await upsertPostings(db.store, [base], now);
      await discardJob(db.store, first.touchedJobs[0].jobKey, now);

      // Same posting with new text, and the same job from another source.
      const edited = { ...base, description: "Changed text." };
      const elsewhere: NormalizedJob = { ...base, source: "remotive", externalId: "r-1", url: "https://remotive.com/x" };
      const later = new Date(now.getTime() + 60_000);
      const again = await upsertPostings(db.store, [edited, elsewhere], later);

      expect(again.newJobs).toBe(0);
      expect(again.touchedJobs).toHaveLength(0);
      expect(again.fingerprinted).toBe(2);
      expect(db.jobs()).toHaveLength(0);
    });
  });
});
