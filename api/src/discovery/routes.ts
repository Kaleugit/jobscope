// Owner Area HTTP routes. The caller has already checked the master account;
// nothing here is reachable by any other account.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../lib/db";
import { atsSource } from "./sources/ats";
import {
  ATS_KINDS,
  companySk,
  DISC_COMPANY_PK,
  DISC_JOB_PK,
  DISC_JOBDESC_PK,
  DISC_RUN_PK,
  type AtsKind,
  type Company,
  type DiscoveredJob,
  type DiscoverySettings,
  type JobDescription,
  type Run,
} from "./model";
import { getSettings } from "./score";
import { discardJob, dynamoStore } from "./store";

export interface RouteResult {
  status: number;
  body: unknown;
}

const ok = (body: unknown, status = 200): RouteResult => ({ status, body });
const bad = (error: string, status = 400): RouteResult => ({ status, body: { error } });

export const WINDOWS = ["today", "24h", "48h", "7d"] as const;
export type JobWindow = (typeof WINDOWS)[number];

/** Start of the window. "today" is since midnight in Brazil, not UTC. */
export function windowStart(window: JobWindow, now = new Date()): Date {
  if (window === "24h") return new Date(now.getTime() - 24 * 3600_000);
  if (window === "48h") return new Date(now.getTime() - 48 * 3600_000);
  if (window === "7d") return new Date(now.getTime() - 7 * 24 * 3600_000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  // Brazil has no DST today; the offset is read from the zone to stay right if it returns.
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", timeZoneName: "longOffset" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "-03:00";
  return new Date(`${day}T00:00:00${offset}`);
}

/** What the panel needs of a job; internal keys stay on the server. */
function summary(job: DiscoveredJob, applicationStatus?: string) {
  const { pk: _pk, sk: _sk, gsi1pk: _g1, gsi1sk: _g2, descriptionHash: _h, descriptionSource: _d, ...rest } = job;
  return { ...rest, applicationStatus };
}

type View = "main" | "review" | "pending";

/** Discarded jobs never reach here: they are deleted when discarded. */
export function viewOf(job: DiscoveredJob): View {
  if (job.llmStatus === "review") return "review";
  if (job.llmStatus === "pending") return "pending";
  return "main";
}

async function applicationStatuses(workspacePk: string): Promise<Map<string, string>> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": workspacePk, ":sk": "APP#" },
      ProjectionExpression: "id, #s",
      ExpressionAttributeNames: { "#s": "status" },
    })
  );
  return new Map((result.Items ?? []).map((i) => [String(i.id), String(i.status)]));
}

async function listJobs(params: Record<string, string | undefined>, workspacePk: string): Promise<RouteResult> {
  const window = (WINDOWS as readonly string[]).includes(params.window ?? "") ? (params.window as JobWindow) : "today";
  const jobs = await dynamoStore.recentJobs(windowStart(window));
  const statuses = await applicationStatuses(workspacePk);
  const counts = { main: 0, pending: 0, review: 0 };
  const out = jobs.map((job) => {
    counts[viewOf(job)]++;
    return summary(job, job.applicationId ? statuses.get(job.applicationId) : undefined);
  });
  return ok({ window, since: windowStart(window).toISOString(), counts, jobs: out });
}

async function getJob(key: string): Promise<RouteResult> {
  const job = await dynamoStore.get<DiscoveredJob>(DISC_JOB_PK, key);
  if (!job) return bad("not found", 404);
  const description = await dynamoStore.get<JobDescription>(DISC_JOBDESC_PK, key);
  return ok({ ...summary(job), description: description?.description ?? "" });
}

/** The owner discards a job: same as any discard, deleted now with a Fingerprint. */
async function discardByOwner(key: string): Promise<RouteResult> {
  const job = await dynamoStore.get<DiscoveredJob>(DISC_JOB_PK, key);
  if (!job) return bad("not found", 404);
  if (job.triage === "promoted") return bad("this job is already an application");
  await discardJob(dynamoStore, key);
  return ok({ discarded: true });
}

/** Called by the applications handler, which owns application creation. */
export async function markPromoted(key: string, applicationId: string): Promise<DiscoveredJob | undefined> {
  const job = await dynamoStore.get<DiscoveredJob>(DISC_JOB_PK, key);
  if (!job) return undefined;
  const next: DiscoveredJob = {
    ...job,
    triage: "promoted",
    applicationId,
    triageHistory: [...job.triageHistory, { triage: "promoted", at: new Date().toISOString() }],
  };
  // Promoted jobs are kept forever: drop the 30-day expiry from job and text.
  delete next.ttl;
  await dynamoStore.put(next);
  const description = await dynamoStore.get<JobDescription>(DISC_JOBDESC_PK, key);
  if (description) {
    delete description.ttl;
    await dynamoStore.put(description);
  }
  return next;
}

export async function jobForPromotion(key: string) {
  const job = await dynamoStore.get<DiscoveredJob>(DISC_JOB_PK, key);
  if (!job) return undefined;
  const description = await dynamoStore.get<JobDescription>(DISC_JOBDESC_PK, key);
  return { job, description: description?.description ?? "" };
}

async function listRuns(): Promise<RouteResult> {
  const runs = await dynamoStore.query<Run>(DISC_RUN_PK, { newestFirst: true, limit: 10 });
  return ok(runs.map(({ pk: _pk, ...run }) => run));
}

const MAX_PROFILE = 8_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readSettings(): Promise<RouteResult> {
  const { pk: _pk, sk: _sk, ...settings } = await getSettings(dynamoStore);
  return ok(settings);
}

async function writeSettings(body: Record<string, unknown>): Promise<RouteResult> {
  const current = await getSettings(dynamoStore);
  const next: DiscoverySettings = { ...current, updatedAt: new Date().toISOString() };

  if (body.alertEmail !== undefined) {
    const email = String(body.alertEmail).trim().toLowerCase();
    if (email && !EMAIL.test(email)) return bad("alertEmail is not an e-mail address");
    if (email !== (current.alertEmail ?? "")) {
      next.alertEmail = email || undefined;
      // The next run creates the SES identity and AWS mails a confirmation link.
      next.alertEmailStatus = email ? "pending" : undefined;
    }
  }
  if (body.alertThreshold !== undefined) {
    const n = Number(body.alertThreshold);
    if (!Number.isInteger(n) || n < 0 || n > 100) return bad("alertThreshold must be an integer from 0 to 100");
    next.alertThreshold = n;
  }
  if (body.minScore !== undefined) {
    const n = Number(body.minScore);
    if (!Number.isInteger(n) || n < 0 || n > 100) return bad("minScore must be an integer from 0 to 100");
    next.minScore = n;
  }
  if (body.ownerYears !== undefined) {
    const n = Number(body.ownerYears);
    if (!Number.isInteger(n) || n < 0 || n > 40) return bad("ownerYears must be an integer from 0 to 40");
    next.ownerYears = n;
  }
  if (body.adherenceProfile !== undefined) {
    const text = String(body.adherenceProfile).trim();
    if (text.length > MAX_PROFILE) return bad(`adherenceProfile is limited to ${MAX_PROFILE} characters`);
    next.adherenceProfile = text;
  }
  await dynamoStore.put(next);
  const { pk: _pk, sk: _sk, ...settings } = next;
  return ok(settings);
}

async function listCompanies(): Promise<RouteResult> {
  const companies = await dynamoStore.query<Company>(DISC_COMPANY_PK);
  return ok(companies.map(({ pk: _pk, sk: _sk, ...c }) => c));
}

/** Adds a company after one live call to its board, so a wrong token fails here, not at 7am. */
async function addCompany(body: Record<string, unknown>): Promise<RouteResult> {
  const ats = String(body.ats ?? "") as AtsKind;
  const token = String(body.token ?? "").trim();
  const name = String(body.name ?? "").trim() || token;
  if (!(ATS_KINDS as readonly string[]).includes(ats)) return bad(`ats must be one of: ${ATS_KINDS.join(", ")}`);
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(token)) return bad("token has unexpected characters");

  let openJobs: number;
  try {
    openJobs = (await atsSource({ ats, token, name }).fetchJobs({ since: new Date(0) })).length;
  } catch (error) {
    return bad(`the ${ats} board "${token}" did not answer: ${(error as Error).message.slice(0, 120)}`);
  }
  const sk = companySk(ats, token);
  if (await dynamoStore.get<Company>(DISC_COMPANY_PK, sk)) return bad("this company is already registered", 409);

  const now = new Date().toISOString();
  const company: Company = {
    pk: DISC_COMPANY_PK, sk, ats, token, name, active: true,
    totalJobsSeen: 0, latamJobsSeen: 0, createdAt: now, updatedAt: now,
  };
  await dynamoStore.put(company);
  const { pk: _pk, sk: _sk, ...rest } = company;
  return ok({ ...rest, openJobs }, 201);
}

async function setCompanyActive(ats: string, token: string, body: Record<string, unknown>): Promise<RouteResult> {
  if (typeof body.active !== "boolean") return bad("active must be true or false");
  const company = await dynamoStore.get<Company>(DISC_COMPANY_PK, `${ats}#${token}`);
  if (!company) return bad("not found", 404);
  const next: Company = { ...company, active: body.active, updatedAt: new Date().toISOString() };
  await dynamoStore.put(next);
  const { pk: _pk, sk: _sk, ...rest } = next;
  return ok(rest);
}

/** Dispatches every /discovery route except /discovery/run and promotion. */
export async function discoveryRoute(
  routeKey: string,
  path: Record<string, string | undefined>,
  query: Record<string, string | undefined>,
  body: Record<string, unknown>,
  workspacePk: string
): Promise<RouteResult | undefined> {
  switch (routeKey) {
    case "GET /discovery/jobs":
      return listJobs(query, workspacePk);
    case "GET /discovery/jobs/{key}":
      return getJob(path.key ?? "");
    case "DELETE /discovery/jobs/{key}":
      return discardByOwner(path.key ?? "");
    case "GET /discovery/runs":
      return listRuns();
    case "GET /discovery/settings":
      return readSettings();
    case "PUT /discovery/settings":
      return writeSettings(body);
    case "GET /discovery/companies":
      return listCompanies();
    case "POST /discovery/companies":
      return addCompany(body);
    case "PATCH /discovery/companies/{ats}/{token}":
      return setCompanyActive(path.ats ?? "", path.token ?? "", body);
    default:
      return undefined;
  }
}
