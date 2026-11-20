// Layer 2: Gemini settles an ambiguous LATAM bucket and gives the Work Nature
// score in the same answer, for several jobs per request: the free tier counts
// requests per day, so a batch of 8 costs one. Everything the model returns is
// validated deterministically, per job, before it touches anything: closed
// enums through Zod, and LATAM evidence must appear literally in the posting.

import { z } from "zod";
import type { ContractType, DiscoveredJob, LatamBucket } from "./model";
import { classifyLocation } from "./rules";

// ── Output contract ──────────────────────────────────────────────────────

export const JudgementSchema = z.object({
  /** False for work outside software, data or AI (sales, health, support...). */
  is_tech_role: z.boolean(),
  latam: z.enum(["sim", "provavel", "nao"]),
  contract_type: z.enum(["contractor", "eor", "full_time_local", "desconhecido"]),
  timezone_requirement: z.string().max(200).nullable(),
  /** Literal quote from the posting that justifies the LATAM answer; null only for "provavel". */
  evidence: z.string().max(600).nullable(),
  score: z.number(),
  reason: z.string().min(1).max(400),
});
export type Judgement = z.infer<typeof JudgementSchema>;

/** The batch answer: one entry per posting, matched back by id. Entries are
 *  validated one by one, so one bad entry never sinks the other seven. */
export const BatchSchema = z.object({
  results: z.array(z.object({ id: z.string() }).passthrough()),
});

const ITEM_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    is_tech_role: { type: "boolean" },
    latam: { type: "string", enum: ["sim", "provavel", "nao"] },
    evidence: { type: "string", nullable: true },
    contract_type: { type: "string", enum: ["contractor", "eor", "full_time_local", "desconhecido"] },
    timezone_requirement: { type: "string", nullable: true },
    score: { type: "integer" },
    reason: { type: "string" },
  },
  required: ["id", "is_tech_role", "latam", "evidence", "contract_type", "timezone_requirement", "score", "reason"],
  propertyOrdering: ["id", "is_tech_role", "latam", "evidence", "contract_type", "timezone_requirement", "score", "reason"],
};

/** Same contract in the JSON Schema subset Gemini's responseSchema accepts. */
export const BATCH_RESPONSE_SCHEMA = {
  type: "object",
  properties: { results: { type: "array", items: ITEM_SCHEMA } },
  required: ["results"],
};

// ── Prompt ───────────────────────────────────────────────────────────────

/** Per posting, so a batch of 8 stays well inside the token limits. */
const MAX_DESCRIPTION_CHARS = 7_000;

const INSTRUCTIONS = `You screen remote job postings for one candidate. Judge each posting on its own, and return one entry per posting in "results", with the posting's id.

For each posting:
0. is_tech_role: true only if the job itself is software, data, AI or technical IT work (AI evaluation and RLHF count). Sales, marketing, health, coaching, support without engineering, operations and talent-pool postings with no specific role are false.
1. latam: can someone living in Brazil be hired for this job?
   - "sim": the posting explicitly opens it to Brazil, LATAM, Latin/South America, the Americas, or anywhere in the world, with nothing contradicting it.
   - "nao": the posting restricts it to a place that excludes Brazil (a country, region or work authorization).
   - "provavel": the posting does not say either way.
   Timezone or working-hours requirements alone are NOT location restrictions: the candidate accepts any timezone.
   A line about THIS role ("Location: Remote - US", "must live in Canada") beats a general statement about the company ("many of our roles can be done from anywhere"). Never answer "sim" from a company-wide sentence when the role's own location line restricts it.
2. evidence: copy, character for character, the shortest sentence or phrase from THAT posting (title, location field or description) that says WHERE the hired person may live or work. It must be a literal substring: no paraphrase, no translation, no ellipsis, no labels like "Location field:". A sentence about the company's market or customers is not evidence. Use null only when latam is "provavel".
3. contract_type: "contractor" (independent contractor / B2B / PJ), "eor" (hired through an employer of record), "full_time_local" (employee of a local entity), or "desconhecido".
4. timezone_requirement: the hours or timezone overlap the job asks for, short, or null.
5. score (0-100): Work Nature. How much the job pays for engineering judgment rather than typing code in a given stack.
   Raise it for: end-to-end ownership; architecture and trade-off decisions; cost awareness; deciding where to use AI and where deterministic code; AI as a working tool (AI-native teams, coding agents); building LLM features with guardrails and evaluation; direct contact with users or clients to define scope; small team, autonomy, many hats; business rules and domain as part of the work; AI model evaluation work.
   Lower it for: working from tickets under supervision; legacy maintenance as the main job; a rigid stack checklist as the core of the role; generic text that never says what the person decides; work outside software, data or AI.
   Staffing / nearshore agency postings that do not describe the client work: score about 50 and say so in the reason. Do not punish missing information; when the agency does describe the work, judge the work.
   Bands: 85+ the work is mostly judgment and matches the candidate; 70-84 strong; 50-69 mixed or undescribed; below 50 mostly execution or a poor fit.
   Seniority and years were already filtered; do not lower the score for them.
6. reason: at most two short lines, in Portuguese (pt-BR), saying why the score is what it is.`;

export interface BatchItem {
  /** Short id used only inside the prompt ("p1", "p2"...). */
  id: string;
  job: DiscoveredJob;
  description: string;
}

function postingBlock(item: BatchItem): string {
  const { job } = item;
  const structured = job.hints.filter((h) => !h.startsWith("tag:")).join(" | ") || "none";
  return [
    `### Posting ${item.id}`,
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location field: ${job.locationRaw || "none"}`,
    `Structured fields: ${structured}`,
    "Description:",
    item.description.slice(0, MAX_DESCRIPTION_CHARS),
  ].join("\n");
}

export function buildBatchPrompt(items: BatchItem[], profile: string): string {
  return [
    INSTRUCTIONS,
    "",
    "## Candidate",
    profile.trim() || "(profile not configured)",
    "",
    "## Postings",
    ...items.map(postingBlock),
  ].join("\n\n");
}

/** Splits a batch answer into raw entries by id. A broken envelope returns undefined. */
export function splitBatchAnswer(raw: string): Map<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = BatchSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const byId = new Map<string, unknown>();
  for (const entry of parsed.data.results) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return byId;
}

// ── Deterministic validation ─────────────────────────────────────────────

/** Folds what models tend to alter when quoting: whitespace, quote styles, dashes, case. */
export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•·▪●◦]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function evidenceIsLiteral(evidence: string, description: string): boolean {
  const quote = normalizeForQuote(evidence).replace(/^["']|["']$/g, "").trim();
  if (quote.length < 4) return false;
  return normalizeForQuote(description).includes(quote);
}

const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** At most two lines; long lines are cut at a word boundary. */
export function twoLines(reason: string): string {
  const lines = reason.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 2);
  return lines.map((l) => (l.length > 180 ? `${l.slice(0, 177).replace(/\s+\S*$/, "")}…` : l)).join("\n");
}

const CONTRACT: Record<Judgement["contract_type"], ContractType> = {
  contractor: "contractor",
  eor: "eor",
  full_time_local: "full_time_local",
  desconhecido: "unknown",
};

export type ApplyResult =
  | { ok: true; job: DiscoveredJob }
  /** The output failed validation: the job goes to the review tab. */
  | { ok: false; job: DiscoveredJob; problem: string };

/** The text a quote may come from: title, location field and description. */
export function postingText(job: Pick<DiscoveredJob, "title" | "locationRaw">, description: string): string {
  return `${job.title}\n${job.locationRaw}\n${description}`;
}

/** Drops labels a model may prepend to a quote ("Location field: Brazil"). */
const stripLabel = (quote: string) => quote.replace(/^\s*(location field|location|title|description)\s*:\s*/i, "");

/**
 * Validates one raw model output and folds it into the job.
 *
 * Invalid JSON or schema is a failure: the job goes to review.
 *
 * LATAM evidence is checked as strictly as the answer is used:
 * - Ambiguous job (layer 1 undecided): the LLM's answer decides, so "sim" or
 *   "nao" must quote the posting literally, or the classification is dropped
 *   and the job goes to review.
 * - Rule said likely: a literal quote may upgrade it to confirmed or discard
 *   it; an unverifiable quote is ignored and the rule's verdict stays.
 * - Rule said confirmed: it stands. A literal quote saying the opposite sends
 *   the job to review rather than flipping it silently.
 * - A layer-1 negative is never lifted.
 * The score is kept in every case that does not go to review.
 */
export function applyJudgement(job: DiscoveredJob, description: string, raw: unknown): ApplyResult {
  const review = (problem: string): ApplyResult => ({
    ok: false,
    problem,
    job: { ...job, llmStatus: "review", reviewReason: problem },
  });

  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return review("resposta do LLM não é JSON válido");
    }
  }
  const parsed = JudgementSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return review(`resposta fora do schema: ${issue?.path.join(".")} ${issue?.message}`);
  }
  const out = parsed.data;

  if (job.latam?.negativeTerm) {
    // Defensive: layer 1 discarded it; nothing the model says lifts that.
    return { ok: true, job: { ...job, llmStatus: "not_needed" } };
  }

  if (!out.is_tech_role) {
    // The area pre-filter let it through on a source category or a loose title;
    // the model read the text and found no technical work.
    const next: DiscoveredJob = {
      ...job,
      llmStatus: "done",
      discardReason: `área (LLM): ${twoLines(out.reason).replace(/\n/g, " ")}`,
    };
    delete next.score;
    delete next.scoreReason;
    delete next.reviewReason;
    return { ok: true, job: next };
  }

  const evidence = out.evidence ? stripLabel(out.evidence).trim() || null : null;
  const literal = evidence ? evidenceIsLiteral(evidence, postingText(job, description)) : false;
  const answer: LatamBucket | undefined =
    out.latam === "sim" ? "confirmed" : out.latam === "nao" ? "discarded" : undefined;

  const next: DiscoveredJob = {
    ...job,
    contractType: CONTRACT[out.contract_type],
    timezoneRequirement: out.timezone_requirement?.trim() || null,
    score: clampScore(out.score),
    scoreReason: twoLines(out.reason),
    llmStatus: "done",
  };
  delete next.reviewReason;

  const ruleBucket = job.latam?.decidedBy === "rule" ? job.latam.bucket : undefined;

  // A "nao" whose own quote names Brazil or LATAM contradicts itself
  // ("nao", evidence "100% Remote, Brazil"): the answer is unusable.
  // "Not open to candidates in Brazil" names Brazil too, and is a valid "nao".
  const negated = evidence !== null && /\b(not|no|except|excluding|excluded|cannot|can't|unable|outside|nao|exceto)\b/i.test(evidence);
  const selfContradicting =
    answer === "discarded" && evidence !== null && !negated && classifyLocation(evidence) === "latam";
  if (selfContradicting) {
    if (ruleBucket) return { ok: true, job: next };
    return review(`o LLM respondeu "nao" citando um trecho que abre para o Brasil: "${evidence}"`);
  }

  if (ruleBucket === "confirmed") {
    if (answer === "discarded" && literal) {
      return review(`a regra confirmou LATAM, mas a vaga diz: "${evidence}"`);
    }
    return { ok: true, job: next };
  }

  if (ruleBucket === "likely") {
    if (!answer || !literal) return { ok: true, job: next };
    next.latam = { bucket: answer, decidedBy: "llm", evidence: evidence! };
  } else {
    // Ambiguous: the LLM decides, and must prove it.
    if (answer && !evidence) return review(`o LLM respondeu "${out.latam}" sem evidência`);
    if (answer && !literal) return review("a evidência citada não existe literalmente na vaga");
    next.latam = { bucket: answer ?? "likely", decidedBy: "llm", evidence: evidence ?? undefined };
  }

  if (next.latam.bucket === "discarded") {
    next.discardReason = `LATAM (LLM): ${evidence}`;
    delete next.score;
    delete next.scoreReason;
  }
  return { ok: true, job: next };
}
