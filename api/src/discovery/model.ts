// Discovery data model. Same single table as the rest of the app, under a DISC#
// prefix that no workspace key can produce (workspace keys are USER#<id>), so
// the demo account cannot reach any of it. Only the master account reads it.
//
// Layout:
//   DISC#COMPANY / <ats>#<token>        a company whose public ATS board is polled
//   DISC#POSTING / <source>#<externalId> one posting as one source sees it (upsert key)
//   DISC#JOB     / <jobKey>             the Discovered Job: postings merged by company + title
//   DISC#JOBDESC / <jobKey>             its clean description, kept apart so the
//                                       panel's index stays small
//   DISC#RUN     / <startedAt>          one collection run and its per-source log
//   DISC#SETTINGS / SETTINGS            owner settings edited in the Owner Area
//
// The panel lists jobs by age through GSI1: gsi1pk = DISC#JOBS, gsi1sk = <publishedAt>#<jobKey>.

export const DISC_COMPANY_PK = "DISC#COMPANY";
export const DISC_POSTING_PK = "DISC#POSTING";
export const DISC_JOB_PK = "DISC#JOB";
export const DISC_JOBDESC_PK = "DISC#JOBDESC";
export const DISC_RUN_PK = "DISC#RUN";
export const DISC_SETTINGS_PK = "DISC#SETTINGS";
export const DISC_SETTINGS_SK = "SETTINGS";

export const GSI1_NAME = "gsi1";
export const DISC_JOBS_GSI1PK = "DISC#JOBS";

export const ATS_KINDS = ["greenhouse", "lever", "ashby"] as const;
export type AtsKind = (typeof ATS_KINDS)[number];

export const AGGREGATORS = ["himalayas", "remotive", "remoteok", "weworkremotely"] as const;
export type Aggregator = (typeof AGGREGATORS)[number];

/** A source is an aggregator or one company's ATS board ("greenhouse:coderoad"). */
export type SourceId = Aggregator | `${AtsKind}:${string}`;

export const companySk = (ats: AtsKind, token: string) => `${ats}#${token}`;
export const postingSk = (source: SourceId, externalId: string) => `${source}#${externalId}`;
export const jobGsi1Sk = (publishedAt: string, jobKey: string) => `${publishedAt}#${jobKey}`;

export interface Company {
  pk: typeof DISC_COMPANY_PK;
  sk: string;
  ats: AtsKind;
  token: string;
  name: string;
  active: boolean;
  totalJobsSeen: number;
  latamJobsSeen: number;
  lastLatamJobAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** The single shape every source module returns. */
export interface NormalizedJob {
  source: SourceId;
  externalId: string;
  url: string;
  company: string;
  title: string;
  /** Plain text, no HTML. */
  description: string;
  locationRaw: string;
  tags: string[];
  salary?: string;
  /** ISO timestamp; undefined when the source does not say. */
  publishedAt?: string;
  /** Structured location or timezone hints the source exposes, kept verbatim for the LATAM rules. */
  locationHints: string[];
}

export interface Posting {
  pk: typeof DISC_POSTING_PK;
  sk: string;
  source: SourceId;
  externalId: string;
  url: string;
  jobKey: string;
  descriptionHash: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type LatamBucket = "confirmed" | "likely" | "discarded";
export type DecidedBy = "rule" | "llm";
export type ContractType = "contractor" | "eor" | "full_time_local" | "unknown";

/** Owner triage of a Discovered Job. "promoted" means it became an Application. */
export type Triage = "new" | "ignored" | "promoted";

/** Where the LLM step stands for this job. "review" = its output failed validation. */
export type LlmStatus = "not_needed" | "pending" | "done" | "review";

export interface JobSource {
  source: SourceId;
  externalId: string;
  url: string;
}

export interface DiscoveredJob {
  pk: typeof DISC_JOB_PK;
  sk: string;
  jobKey: string;
  gsi1pk: typeof DISC_JOBS_GSI1PK;
  gsi1sk: string;

  company: string;
  title: string;
  locationRaw: string;
  tags: string[];
  salary?: string;
  /** Age of the job is measured from here; falls back to firstSeenAt when the source is silent. */
  publishedAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sources: JobSource[];
  descriptionHash: string;

  /** Area pre-filter verdict. */
  areaOk: boolean;
  latam?: {
    bucket: LatamBucket;
    decidedBy: DecidedBy;
    evidence?: string;
    /** A negative-list term matched; the LLM can never lift this. */
    negativeTerm?: string;
  };
  experienceBarrier?: { blocked: boolean; reason?: string };
  /** Remote job at a Brazilian company paid in BRL: shown, never alerted. */
  localMarket?: boolean;
  /** Staffing or nearshore agency whose client work may be undescribed. */
  agency?: boolean;
  contractType?: ContractType;
  timezoneRequirement?: string | null;
  /** Work Nature score, 0 to 100, and its reason (max two lines). */
  score?: number;
  scoreReason?: string;
  llmStatus: LlmStatus;
  /** Set when a filter removed the job, with the reason, for the audit tab. */
  discardReason?: string;

  triage: Triage;
  triageHistory: { triage: Triage; at: string }[];
  applicationId?: string;
  alertedAt?: string;
  /** Marked after 30 days absent from every source. */
  expired?: boolean;
}

export interface JobDescription {
  pk: typeof DISC_JOBDESC_PK;
  sk: string;
  description: string;
}

export interface SourceRunLog {
  source: SourceId;
  fetched: number;
  errors: number;
  errorMessages?: string[];
  durationMs: number;
}

export interface Run {
  pk: typeof DISC_RUN_PK;
  sk: string;
  trigger: "schedule" | "manual";
  startedAt: string;
  finishedAt?: string;
  sources: SourceRunLog[];
  newJobs: number;
  llmCalls: number;
  alertsSent: number;
}

export interface DiscoverySettings {
  pk: typeof DISC_SETTINGS_PK;
  sk: typeof DISC_SETTINGS_SK;
  alertEmail?: string;
  /** SES identity state of alertEmail; alerts keep going to the last verified address meanwhile. */
  alertEmailStatus?: "pending" | "verified";
  verifiedAlertEmail?: string;
  alertThreshold: number;
  /** The owner's years of experience; a job asking for more is blocked by the Experience Barrier. */
  ownerYears: number;
  /** Adherence Profile text sent to the LLM. No contact data, no employer internals. */
  adherenceProfile: string;
  updatedAt: string;
}

export const DEFAULT_SETTINGS: Omit<DiscoverySettings, "pk" | "sk" | "updatedAt"> = {
  alertThreshold: 80,
  ownerYears: 3,
  adherenceProfile: "",
};
