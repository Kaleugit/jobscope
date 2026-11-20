import {
  companySk,
  DISC_COMPANY_PK,
  DISC_JOBDESC_PK,
  ATS_KINDS,
  type AtsKind,
  type Company,
  type DiscoveredJob,
  type JobDescription,
} from "./model";
import { evaluateRules, type RuleOutcome } from "./rules";
import type { KeyValueStore } from "./store";

/** Writes a rule outcome onto the job. Pure: the caller persists. */
export function applyRuleOutcome(job: DiscoveredJob, outcome: RuleOutcome): DiscoveredJob {
  const next: DiscoveredJob = {
    ...job,
    needsEvaluation: false,
    areaOk: outcome.area.ok,
    experienceBarrier: outcome.barrier.blocked
      ? { blocked: true, reason: outcome.barrier.reason }
      : { blocked: false },
    localMarket: outcome.localMarket,
    agency: outcome.agency,
    discardReason: outcome.discardReason,
  };

  if (outcome.latam.bucket === "ambiguous") {
    // Undecided until the LLM quotes the description.
    delete next.latam;
  } else {
    next.latam = {
      bucket: outcome.latam.bucket,
      decidedBy: "rule",
      evidence: outcome.latam.evidence,
      negativeTerm: outcome.latam.negativeTerm,
    };
  }

  // A fresh rule pass invalidates any earlier score for older text.
  if (outcome.needsLlm) {
    next.llmStatus = "pending";
  } else {
    next.llmStatus = "not_needed";
    delete next.score;
    delete next.scoreReason;
  }
  return next;
}

/** ATS companies behind a job's sources ("greenhouse:coderoad" -> greenhouse, coderoad). */
function atsCompaniesOf(job: DiscoveredJob): { ats: AtsKind; token: string }[] {
  return job.sources.flatMap((s) => {
    const [ats, ...rest] = s.source.split(":");
    return rest.length && (ATS_KINDS as readonly string[]).includes(ats)
      ? [{ ats: ats as AtsKind, token: rest.join(":") }]
      : [];
  });
}

export interface EvaluateStats {
  evaluated: number;
  discarded: number;
  toLlm: number;
}

/**
 * Runs layer 1 on every job flagged needsEvaluation and persists the result.
 * Counts each job once in its ATS companies' statistics, the first time it is
 * judged, so the Owner Area can show which companies really hire in LATAM.
 */
export async function evaluatePending(
  store: KeyValueStore,
  jobs: DiscoveredJob[],
  ownerYears: number,
  now = new Date()
): Promise<EvaluateStats & { jobs: DiscoveredJob[] }> {
  const stats: EvaluateStats = { evaluated: 0, discarded: 0, toLlm: 0 };
  const out: DiscoveredJob[] = [];
  const companyDeltas = new Map<string, { total: number; latam: number }>();

  for (const job of jobs) {
    if (!job.needsEvaluation) continue;
    const description =
      (await store.get<JobDescription>(DISC_JOBDESC_PK, job.jobKey))?.description ?? "";
    const firstJudgement = job.areaOk === undefined;
    const next = applyRuleOutcome(job, evaluateRules(job, description, ownerYears));
    await store.put(next);
    out.push(next);

    stats.evaluated++;
    if (next.discardReason) stats.discarded++;
    else stats.toLlm++;

    if (firstJudgement) {
      const latamOpen = next.latam?.bucket === "confirmed" || next.latam?.bucket === "likely";
      for (const company of atsCompaniesOf(next)) {
        const key = companySk(company.ats, company.token);
        const delta = companyDeltas.get(key) ?? { total: 0, latam: 0 };
        delta.total++;
        if (latamOpen) delta.latam++;
        companyDeltas.set(key, delta);
      }
    }
  }

  for (const [sk, delta] of companyDeltas) {
    const company = await store.get<Company>(DISC_COMPANY_PK, sk);
    if (!company) continue;
    const updated: Company = {
      ...company,
      totalJobsSeen: company.totalJobsSeen + delta.total,
      latamJobsSeen: company.latamJobsSeen + delta.latam,
      lastLatamJobAt: delta.latam ? now.toISOString() : company.lastLatamJobAt,
      updatedAt: now.toISOString(),
    };
    await store.put(updated);
  }

  return { ...stats, jobs: out };
}
