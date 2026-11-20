// Layer 1: deterministic filters. Settles most jobs without any LLM call:
// area, remote, LATAM bucket, Experience Barrier, Local Market and Agency.
// All the vocabulary is in rules-config.ts.

import * as cfg from "./rules-config";
import type { DiscoveredJob, LatamBucket } from "./model";
import { foldText, normalizeCompany } from "./text";

/** Padded folded text, so " term " matching is a whole-word match. */
const pad = (text: string) => ` ${foldText(text)} `;
const has = (padded: string, term: string) => padded.includes(` ${foldText(term)} `);
const firstOf = (padded: string, terms: string[]) => terms.find((t) => foldText(t) && has(padded, t));

// ── Area ─────────────────────────────────────────────────────────────────

export type AreaVerdict = { ok: true } | { ok: false; reason: string };

export function judgeArea(title: string, tags: string[]): AreaVerdict {
  const t = pad(title);
  const hard = firstOf(t, cfg.AREA_HARD_EXCLUDE);
  if (hard) return { ok: false, reason: `área fora do alvo: "${hard}"` };
  if (firstOf(t, cfg.AREA_CORE)) return { ok: true };
  const soft = firstOf(t, cfg.AREA_SOFT_EXCLUDE);
  if (soft) return { ok: false, reason: `área não técnica: "${soft}"` };
  if (firstOf(t, cfg.AREA_INCLUDE)) return { ok: true };
  const categories = pad(tags.join(" | "));
  if (firstOf(categories, cfg.AREA_CATEGORY_INCLUDE)) return { ok: true };
  return { ok: false, reason: "área não identificada como técnica" };
}

// ── Remote ───────────────────────────────────────────────────────────────

function hintValues(hints: string[], kind: string): string[] {
  const prefix = `${kind}:`;
  return hints.filter((h) => h.startsWith(prefix)).map((h) => h.slice(prefix.length).trim());
}

export function notRemoteReason(hints: string[]): string | undefined {
  const workplace = hintValues(hints, "workplace").map(foldText);
  if (workplace.length === 0 || workplace.includes("remote")) return undefined;
  const bad = workplace.find((w) => cfg.NOT_REMOTE_WORKPLACE.includes(w));
  return bad ? `não é remota (${bad})` : undefined;
}

// ── LATAM ────────────────────────────────────────────────────────────────

export type LocationClass = "latam" | "worldwide" | "elsewhere";

/** One structured location value: names LATAM, names no place, or names another place. */
export function classifyLocation(value: string): LocationClass {
  const p = pad(value);
  if (firstOf(p, cfg.LATAM_LOCATIONS)) return "latam";
  const leftover = foldText(value)
    .split(" ")
    .filter((word) => word && !cfg.PLACELESS_LOCATION_WORDS.includes(word));
  return leftover.length === 0 ? "worldwide" : "elsewhere";
}

export type LatamRuleVerdict =
  | { bucket: LatamBucket; evidence: string; negativeTerm?: string }
  /** Layer 1 could not decide; the LLM must, with a literal quote. */
  | { bucket: "ambiguous"; positiveHint?: string };

export function negativeTermIn(text: string): string | undefined {
  const p = pad(text);
  const phrase = firstOf(p, cfg.LATAM_NEGATIVE_PHRASES);
  if (phrase) return phrase;
  for (const match of p.matchAll(cfg.RESIDENCE_PATTERN)) {
    const place = match[1].trim();
    const firstWord = place.split(" ")[0];
    if (cfg.RESIDENCE_NOT_A_PLACE.includes(firstWord)) continue;
    if (cfg.RESIDENCE_OK.some((ok) => ` ${place} `.includes(` ${foldText(ok)} `))) continue;
    return match[0].trim();
  }
  return undefined;
}

export function judgeLatam(job: Pick<DiscoveredJob, "title" | "locationRaw" | "hints">, description: string): LatamRuleVerdict {
  // Negatives always win, wherever they appear.
  const negative = negativeTermIn(`${job.title}\n${job.locationRaw}\n${description}`);
  if (negative) return { bucket: "discarded", evidence: negative, negativeTerm: negative };

  const values = [
    ...hintValues(job.hints, "location"),
    ...hintValues(job.hints, "region"),
  ].filter(Boolean);

  const latam = values.find((v) => classifyLocation(v) === "latam");
  if (latam) return { bucket: "confirmed", evidence: `localização: ${latam}` };

  const countries = hintValues(job.hints, "country").map(foldText);
  const brazil = countries.find((c) => cfg.BRAZIL_COUNTRY_CODES.includes(c) || c === "brazil" || c === "brasil");
  if (brazil) return { bucket: "confirmed", evidence: `país: ${brazil.toUpperCase()}` };

  const classes = values.map(classifyLocation);
  if (classes.length > 0 && classes.every((c) => c === "elsewhere")) {
    return { bucket: "discarded", evidence: `localização: ${values.join(", ")}` };
  }

  const positive = firstOf(pad(description), cfg.LATAM_POSITIVE_PHRASES);
  if (classes.includes("worldwide")) {
    // Open to anyone on the structured field: probable. The LLM may still
    // confirm it with a quote, or catch a contrary line in the text.
    return { bucket: "likely", evidence: `localização: ${values.find((v) => classifyLocation(v) === "worldwide")}` };
  }
  return { bucket: "ambiguous", positiveHint: positive };
}

// ── Experience Barrier ───────────────────────────────────────────────────

// "5+ years", "3-5 years" (the dash folds to a space), "3 to 5 years", "five years",
// "5 anos". Ranges count by their lower end.
const YEARS_PATTERN =
  /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)(?: plus)?(?: (?:(?:to|a|ate|or|ou|e) )?(\d{1,2}))?(?: plus)? (?:years?|yrs?|anos?)\b/g;
/** What follows "N years" in a requirement ("of", "in", "with", "working"). */
const REQUIREMENT_NEXT =
  /^ (?:of|in|with|working|building|developing|using|as|experience|exp|professional|hands|relevant|de|em|com|como|na|no|atuando|experiencia|minimum|min)\b/;
/** Anywhere near: the line talks about experience. */
const EXPERIENCE_NEAR =
  /\b(?:experience|experiencia|experienced|background|track record|minimum|at least|minimo|pelo menos|required|requisitos?)\b/;

/** Minimum years each requirement asks for; ranges count by their lower end. */
export function requiredYears(description: string): number[] {
  const text = foldText(description.replace(/\+/g, " plus "));
  const found: number[] = [];
  for (const match of text.matchAll(YEARS_PATTERN)) {
    const n = /^\d+$/.test(match[1]) ? Number(match[1]) : cfg.NUMBER_WORDS[match[1]];
    if (!n || n > 15) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const after = text.slice(end, end + 40);
    if (/^ ago\b/.test(after)) continue;
    const before = text.slice(Math.max(0, start - 60), start);
    // "in 5 years", "over the past 10 years": about the company, not the candidate.
    if (/\b(?:in|within|next|every|for over|over the past|past)\s*$/.test(before)) continue;
    if (REQUIREMENT_NEXT.test(after) || EXPERIENCE_NEAR.test(`${before} ${after}`)) found.push(n);
  }
  return found;
}

export type BarrierVerdict = { blocked: false } | { blocked: true; reason: string };

export function judgeBarrier(
  job: Pick<DiscoveredJob, "title" | "hints">,
  description: string,
  ownerYears: number
): BarrierVerdict {
  const senior = firstOf(pad(job.title), cfg.SENIOR_TITLE_WORDS);
  if (senior) return { blocked: true, reason: `nível sênior no título: "${senior}"` };

  const seniority = hintValues(job.hints, "seniority").map(foldText);
  if (seniority.length > 0 && seniority.every((s) => cfg.SENIOR_SENIORITY_HINTS.includes(s))) {
    return { blocked: true, reason: `nível ${seniority.join("/")} na fonte` };
  }

  const years = requiredYears(description);
  const most = years.length ? Math.max(...years) : 0;
  if (most > ownerYears) return { blocked: true, reason: `pede ${most}+ anos (você tem ${ownerYears})` };
  return { blocked: false };
}

// ── Local Market, Agency ─────────────────────────────────────────────────

const PT_WORDS = ["de", "para", "com", "voce", "nossa", "nosso", "vaga", "empresa", "experiencia", "atuar", "conhecimento", "trabalho", "requisitos", "desejavel"];
const EN_WORDS = ["the", "and", "you", "with", "our", "will", "experience", "work", "team", "requirements", "we", "are"];

export function isPortuguese(text: string): boolean {
  const words = foldText(text).split(" ");
  let pt = 0;
  let en = 0;
  for (const word of words) {
    if (PT_WORDS.includes(word)) pt++;
    else if (EN_WORDS.includes(word)) en++;
  }
  return pt > en && pt >= 5;
}

export function isLocalMarket(title: string, description: string, salary?: string): boolean {
  if (/R\$\s?\d/.test(`${description} ${salary ?? ""}`)) return true;
  if (isPortuguese(`${title}\n${description}`)) return true;
  return Boolean(firstOf(pad(`${description} ${salary ?? ""}`), cfg.LOCAL_MARKET_PHRASES));
}

export function isAgency(company: string, description: string, tags: string[]): boolean {
  const name = ` ${normalizeCompany(company)} `;
  if (cfg.AGENCY_COMPANIES.some((a) => name.includes(` ${foldText(a)} `))) return true;
  // Lever teams named "Client - Healthcare Platform" are agency placements.
  if (tags.some((t) => /^client\b/i.test(t.trim()))) return true;
  return Boolean(firstOf(pad(description), cfg.AGENCY_PHRASES));
}

// ── All together ─────────────────────────────────────────────────────────

export interface RuleOutcome {
  area: AreaVerdict;
  notRemote?: string;
  latam: LatamRuleVerdict;
  barrier: BarrierVerdict;
  localMarket: boolean;
  agency: boolean;
  /** Set when a filter removed the job; the first filter that fired wins. */
  discardReason?: string;
  /** Survived every filter: the LLM scores it (and settles LATAM when ambiguous). */
  needsLlm: boolean;
}

export function evaluateRules(
  job: Pick<DiscoveredJob, "title" | "company" | "locationRaw" | "hints" | "tags" | "salary">,
  description: string,
  ownerYears: number
): RuleOutcome {
  const area = judgeArea(job.title, job.tags);
  const notRemote = notRemoteReason(job.hints);
  const latam = judgeLatam(job, description);
  const barrier = judgeBarrier(job, description, ownerYears);
  const localMarket = isLocalMarket(job.title, description, job.salary);
  const agency = isAgency(job.company, description, job.tags);

  const discardReason = !area.ok
    ? area.reason
    : notRemote
      ? notRemote
      : latam.bucket === "discarded"
        ? `LATAM: ${latam.evidence}`
        : barrier.blocked
          ? `Barreira de Experiência: ${barrier.reason}`
          : undefined;

  return { area, notRemote, latam, barrier, localMarket, agency, discardReason, needsLlm: !discardReason };
}
