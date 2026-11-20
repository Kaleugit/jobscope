import { describe, expect, it } from "vitest";
import { parseQuotaError, QuotaExhausted, runQueue } from "../src/discovery/gemini";
import {
  applyJudgement,
  buildBatchPrompt,
  evidenceIsLiteral,
  splitBatchAnswer,
  twoLines,
} from "../src/discovery/judge";
import type { DiscoveredJob } from "../src/discovery/model";
import { scorePending } from "../src/discovery/score";
import { memoryStore } from "../src/discovery/memory-store";

const description =
  "We are a small team building AI tools. This role is open to candidates in Latin America.\n" +
  "You will own features end to end. Pay in USD as an independent contractor.";

const baseJob = (over: Partial<DiscoveredJob> = {}): DiscoveredJob =>
  ({
    pk: "DISC#JOB",
    sk: "k",
    jobKey: "k",
    gsi1pk: "DISC#JOBS",
    gsi1sk: "2026-11-20T10:00:00.000Z#k",
    company: "Acme",
    title: "Software Engineer",
    locationRaw: "Worldwide",
    tags: [],
    publishedAt: "2026-11-20T10:00:00.000Z",
    firstSeenAt: "",
    lastSeenAt: "",
    sources: [],
    hints: [],
    descriptionSource: "",
    descriptionHash: "",
    needsEvaluation: false,
    llmStatus: "pending",
    triage: "new",
    triageHistory: [],
    ...over,
  }) as DiscoveredJob;

const answer = (over: Record<string, unknown> = {}) => ({
  is_tech_role: true,
  latam: "sim",
  evidence: "This role is open to candidates in Latin America.",
  contract_type: "contractor",
  timezone_requirement: null,
  score: 82,
  reason: "Ownership de ponta a ponta.\nTime pequeno com IA.",
  ...over,
});

describe("evidence check", () => {
  it("accepts a literal quote despite case, spacing and quote styles", () => {
    expect(evidenceIsLiteral("this ROLE is open   to candidates in latin america", description)).toBe(true);
    expect(evidenceIsLiteral("“You will own features end to end.”", description)).toBe(true);
  });

  it("rejects a paraphrase", () => {
    expect(evidenceIsLiteral("Open to LATAM applicants", description)).toBe(false);
  });

  it("rejects quotes too short to mean anything", () => {
    expect(evidenceIsLiteral("in", description)).toBe(false);
  });
});

describe("applyJudgement", () => {
  it("rejects output outside the schema", () => {
    const r = applyJudgement(baseJob(), description, answer({ latam: "maybe" }));
    expect(r.ok).toBe(false);
    expect(r.job.llmStatus).toBe("review");
  });

  it("discards a job the model finds is not technical work, dropping the score", () => {
    const r = applyJudgement(baseJob(), description, answer({ is_tech_role: false, score: 30, reason: "Facilitação de grupos de saúde mental." }));
    expect(r.ok).toBe(true);
    expect(r.job.discardReason).toMatch(/^área \(LLM\): Facilitação/);
    expect(r.job.score).toBeUndefined();
  });

  it("rejects an answer without is_tech_role", () => {
    const { is_tech_role: _omit, ...rest } = answer();
    expect(applyJudgement(baseJob(), description, rest).ok).toBe(false);
  });

  it("rejects invalid JSON", () => {
    expect(applyJudgement(baseJob(), description, "{not json").ok).toBe(false);
  });

  it("clamps the score and keeps at most two lines of reason", () => {
    const r = applyJudgement(baseJob(), description, answer({ score: 140, reason: "a\nb\nc" }));
    expect(r.job.score).toBe(100);
    expect(r.job.scoreReason).toBe("a\nb");
    expect(applyJudgement(baseJob(), description, answer({ score: -5 })).job.score).toBe(0);
  });

  describe("ambiguous job (the LLM decides)", () => {
    it("confirms with a literal quote", () => {
      const r = applyJudgement(baseJob(), description, answer());
      expect(r.ok).toBe(true);
      expect(r.job.latam).toEqual({ bucket: "confirmed", decidedBy: "llm", evidence: "This role is open to candidates in Latin America." });
      expect(r.job.contractType).toBe("contractor");
    });

    it("sends to review when the quote is not in the posting", () => {
      const r = applyJudgement(baseJob(), description, answer({ evidence: "Hiring across LATAM" }));
      expect(r.ok).toBe(false);
      expect(r.job.llmStatus).toBe("review");
      expect(r.job.reviewReason).toMatch(/literalmente/);
    });

    it("sends to review a yes/no without evidence", () => {
      expect(applyJudgement(baseJob(), description, answer({ evidence: null })).ok).toBe(false);
    });

    it("accepts 'provavel' without evidence", () => {
      const r = applyJudgement(baseJob(), description, answer({ latam: "provavel", evidence: null }));
      expect(r.ok).toBe(true);
      expect(r.job.latam?.bucket).toBe("likely");
    });

    it("discards on a literal 'nao' and drops the score", () => {
      const text = "Candidates must hold a valid right to work in Spain.";
      const r = applyJudgement(baseJob(), text, answer({ latam: "nao", evidence: text }));
      expect(r.job.latam?.bucket).toBe("discarded");
      expect(r.job.discardReason).toMatch(/Spain/);
      expect(r.job.score).toBeUndefined();
    });

    it("strips a label the model prepends", () => {
      const r = applyJudgement(baseJob({ locationRaw: "Brazil" }), "", answer({ evidence: "Location field: Brazil" }));
      expect(r.ok).toBe(true);
    });

    it("sends to review a 'nao' whose quote opens the job to Brazil", () => {
      const r = applyJudgement(baseJob({ locationRaw: "100% Remote, Brazil" }), "", answer({ latam: "nao", evidence: "100% Remote, Brazil" }));
      expect(r.ok).toBe(false);
    });

    it("keeps a negated quote that names Brazil as a valid 'nao'", () => {
      const text = "This role is not open to candidates in Brazil.";
      const r = applyJudgement(baseJob(), text, answer({ latam: "nao", evidence: text }));
      expect(r.job.latam?.bucket).toBe("discarded");
    });
  });

  describe("job the rule already decided", () => {
    const confirmed = baseJob({ latam: { bucket: "confirmed", decidedBy: "rule", evidence: "localização: Brazil" } });
    const likely = baseJob({ latam: { bucket: "likely", decidedBy: "rule", evidence: "localização: Worldwide" } });

    it("keeps a rule confirmation and the score even if the quote is bad", () => {
      const r = applyJudgement(confirmed, description, answer({ evidence: "not in the text at all" }));
      expect(r.ok).toBe(true);
      expect(r.job.latam?.decidedBy).toBe("rule");
      expect(r.job.score).toBe(82);
    });

    it("sends to review when a literal quote contradicts the rule", () => {
      const text = "This position is only open to US residents.";
      expect(applyJudgement(confirmed, text, answer({ latam: "nao", evidence: text })).ok).toBe(false);
    });

    it("ignores a self-contradicting 'nao' on a rule-confirmed job", () => {
      const job = baseJob({ ...confirmed, locationRaw: "100% Remote, Brazil" });
      const r = applyJudgement(job, "", answer({ latam: "nao", evidence: "100% Remote, Brazil" }));
      expect(r.ok).toBe(true);
      expect(r.job.latam?.bucket).toBe("confirmed");
    });

    it("upgrades a rule 'likely' only with a literal quote", () => {
      expect(applyJudgement(likely, description, answer()).job.latam?.bucket).toBe("confirmed");
      const r = applyJudgement(likely, description, answer({ evidence: "invented" }));
      expect(r.ok).toBe(true);
      expect(r.job.latam?.bucket).toBe("likely");
      expect(r.job.latam?.decidedBy).toBe("rule");
    });

    it("never lifts a layer-1 negative", () => {
      const job = baseJob({ latam: { bucket: "discarded", decidedBy: "rule", evidence: "us only", negativeTerm: "us only" } });
      const r = applyJudgement(job, description, answer());
      expect(r.job.latam?.bucket).toBe("discarded");
      expect(r.job.score).toBeUndefined();
    });
  });

  it("twoLines cuts long lines at a word", () => {
    expect(twoLines("x ".repeat(200)).length).toBeLessThanOrEqual(181);
  });
});

describe("batch answers", () => {
  it("splits by id and tolerates extra fields", () => {
    const map = splitBatchAnswer(JSON.stringify({ results: [{ id: "p1", ...answer() }, { id: "p2", ...answer() }] }));
    expect([...map!.keys()]).toEqual(["p1", "p2"]);
  });

  it("returns undefined for a broken envelope", () => {
    expect(splitBatchAnswer("[]")).toBeUndefined();
    expect(splitBatchAnswer("nope")).toBeUndefined();
  });

  it("puts every posting in the prompt with its id", () => {
    const prompt = buildBatchPrompt(
      [
        { id: "p1", job: baseJob({ title: "One" }), description: "first" },
        { id: "p2", job: baseJob({ title: "Two" }), description: "second" },
      ],
      "profile"
    );
    expect(prompt).toContain("### Posting p1");
    expect(prompt).toContain("### Posting p2");
    expect(prompt).toContain("profile");
  });
});

describe("quota handling", () => {
  it("reads a per-day quota from Google's structured 429", () => {
    const body = JSON.stringify({
      error: {
        details: [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "50453s" },
        ],
      },
    });
    expect(parseQuotaError(body)).toEqual({ daily: true, limit: "20", retryMs: 50453500 });
  });

  it("treats a per-minute quota as retryable", () => {
    const body = JSON.stringify({
      error: { details: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }, { retryDelay: "12s" }] },
    });
    expect(parseQuotaError(body)).toEqual({ daily: false, limit: undefined, retryMs: 12500 });
  });

  it("stops the queue at the cap and on quota, reporting what is left", async () => {
    const capped = await runQueue([1, 2, 3, 4], { intervalMs: 0, maxCalls: 2 }, async (n) => n);
    expect(capped).toMatchObject({ done: [1, 2], leftover: 2, stoppedBy: "cap" });

    const quota = await runQueue([1, 2, 3], { intervalMs: 0, maxCalls: 10 }, async (n) => {
      if (n === 2) throw new QuotaExhausted("daily");
      return n;
    });
    expect(quota).toMatchObject({ done: [1], leftover: 2, stoppedBy: "quota" });
  });
});

describe("scorePending", () => {
  const NOW = new Date("2026-11-20T23:00:00.000Z");

  function memory(jobs: DiscoveredJob[]) {
    const m = memoryStore([
      ...jobs,
      ...jobs.map((j) => ({ pk: "DISC#JOBDESC", sk: j.jobKey, description })),
    ]);
    return { ...m, job: (key: string) => m.get("DISC#JOB", key) as unknown as DiscoveredJob };
  }

  const jobs = Array.from({ length: 10 }, (_, i) =>
    baseJob({ jobKey: `k${i}`, sk: `k${i}`, publishedAt: `2026-11-20T${String(10 + i).padStart(2, "0")}:00:00.000Z` })
  );

  it("scores in batches of 8: 10 jobs cost 2 calls", async () => {
    const db = memory(jobs);
    let calls = 0;
    const generate = async (prompt: string) => {
      calls++;
      const ids = [...prompt.matchAll(/### Posting (p\d+)/g)].map((m) => m[1]);
      return JSON.stringify({ results: ids.map((id) => ({ id, ...answer() })) });
    };
    const stats = await scorePending(db.store, generate, { intervalMs: 0, maxCalls: 10 }, { now: NOW });
    expect(calls).toBe(2);
    expect(stats.scored).toBe(10);
    expect(stats.pending).toBe(0);
  });

  it("scores the freshest jobs first when the cap is short", async () => {
    const db = memory(jobs);
    const generate = async (prompt: string) => {
      const ids = [...prompt.matchAll(/### Posting (p\d+)/g)].map((m) => m[1]);
      return JSON.stringify({ results: ids.map((id) => ({ id, ...answer() })) });
    };
    const stats = await scorePending(db.store, generate, { intervalMs: 0, maxCalls: 1 }, { now: NOW });
    expect(stats.scored).toBe(8);
    expect(stats.pending).toBe(2);
    // k9 and k8 are the newest; the two oldest wait.
    expect(db.job("k9").llmStatus).toBe("done");
    expect(db.job("k0").llmStatus).toBe("pending");
  });

  it("a missing entry retries next run, then goes to review", async () => {
    const db = memory([jobs[0]]);
    const empty = async () => JSON.stringify({ results: [] });
    await scorePending(db.store, empty, { intervalMs: 0, maxCalls: 5 }, { now: NOW });
    expect(db.job("k0").llmStatus).toBe("pending");
    await scorePending(db.store, empty, { intervalMs: 0, maxCalls: 5 }, { now: NOW });
    expect(db.job("k0").llmStatus).toBe("review");
  });

  it("a network error leaves the batch pending without counting an attempt", async () => {
    const db = memory([jobs[0]]);
    const stats = await scorePending(db.store, async () => { throw new Error("socket hang up"); }, { intervalMs: 0, maxCalls: 5 });
    expect(stats.errors).toHaveLength(1);
    expect(db.job("k0").llmAttempts).toBeUndefined();
    expect(db.job("k0").llmStatus).toBe("pending");
  });

  it("discards below the Minimum Score: deleted, fingerprinted, not counted as scored", async () => {
    const db = memory([jobs[0]]);
    const generate = async () => JSON.stringify({ results: [{ id: "p1", ...answer({ score: 55 }) }] });
    const stats = await scorePending(db.store, generate, { intervalMs: 0, maxCalls: 5 }, { now: NOW });
    expect(stats.belowMinimum).toBe(1);
    expect(stats.scored).toBe(0);
    expect(db.get("DISC#JOB", "k0")).toBeUndefined();
    expect(db.get("DISC#JOBDESC", "k0")).toBeUndefined();
    expect(db.get("DISC#GONE", "k0")).toBeDefined();
  });

  it("discards what the LLM finds is not technical work", async () => {
    const db = memory([jobs[0]]);
    const generate = async () => JSON.stringify({ results: [{ id: "p1", ...answer({ is_tech_role: false }) }] });
    const stats = await scorePending(db.store, generate, { intervalMs: 0, maxCalls: 5 }, { now: NOW });
    expect(stats.discardedByLlm).toBe(1);
    expect(db.get("DISC#JOB", "k0")).toBeUndefined();
  });

  it("only scores jobs the panel can still show (published in the last 7 days)", async () => {
    const old = baseJob({ jobKey: "old", sk: "old", publishedAt: "2026-09-01T00:00:00.000Z" });
    const db = memory([old]);
    let calls = 0;
    await scorePending(db.store, async () => { calls++; return "{}"; }, { intervalMs: 0, maxCalls: 5 }, { now: NOW });
    expect(calls).toBe(0);
  });
});
