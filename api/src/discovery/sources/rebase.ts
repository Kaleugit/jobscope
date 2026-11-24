import { fetchJson, sleep } from "../http";
import type { NormalizedJob, Source } from "../model";
import { htmlToText } from "../text";

// Rebase Jobs (rebasedev.com.br/jobs): a curated catalog of remote dev jobs at
// foreign companies that hire people living in Brazil, read from each
// company's own careers site twice a day. /api/v1/agent/jobs returns the full
// posting text and the direct apply link, newest first, 50 per page at most.
// Needs the owner's personal token (REBASE_API_TOKEN); 60 calls a minute.

interface RebaseJob {
  slug: string;
  title: string;
  company?: { name?: string; slug?: string };
  location?: string | null;
  hires_in_brazil?: string | null;
  remoto_comprovado?: boolean;
  seniority?: string | null;
  skills?: string[];
  hiring_models?: string[];
  salary?: string | null;
  published_at?: string | null;
  first_seen_at?: string | null;
  apply_url?: string | null;
  url: string;
  description?: string | null;
  closed_at?: string | null;
}

interface RebasePage {
  data?: RebaseJob[];
  meta?: { pagina?: number; paginas?: number };
}

const BASE = "https://rebasedev.com.br/api/v1/agent/jobs";
/** The whole catalog is ~14 pages today; the cap only guards against a runaway. */
const MAX_PAGES = 30;
const PAGE_GAP_MS = 1_200;
/** The catalog dates a job by the ATS, and may find it a day or two later. */
const LATE_MS = 3 * 24 * 60 * 60 * 1000;

export function parseRebase(page: RebasePage): NormalizedJob[] {
  return (page.data ?? [])
    .filter((job) => !job.closed_at)
    .map((job) => {
      const locations = (job.location ?? "").split(";").map((l) => l.trim()).filter(Boolean);
      return {
        source: "rebase",
        externalId: job.slug,
        url: job.apply_url || job.url,
        company: job.company?.name ?? "",
        title: job.title,
        description: htmlToText(job.description ?? ""),
        locationRaw: locations.join(", "),
        tags: job.skills ?? [],
        salary: job.salary?.trim() || undefined,
        publishedAt: job.published_at ?? job.first_seen_at ?? undefined,
        hints: [
          ...locations.map((l) => `location:${l}`),
          // The catalog's own verdict, backed by evidence it checked.
          ...(job.hires_in_brazil === "yes" ? ["country:brazil"] : []),
          ...(job.seniority ? [`seniority:${job.seniority}`] : []),
          ...(job.hiring_models ?? []).map((m) => `contract:${m}`),
          ...(job.remoto_comprovado ? ["workplace:remote"] : []),
        ],
      };
    });
}

export function rebase(token?: string): Source {
  return {
    id: "rebase",
    async fetchJobs(ctx) {
      const since = new Date(ctx.since.getTime() - LATE_MS);
      // No token, no access: the API answers 401. Skip instead of failing the run.
      if (!token) return [];
      const headers = { Authorization: `Bearer ${token}` };
      const seen = new Map<string, NormalizedJob>();

      for (let page = 1; page <= MAX_PAGES; page++) {
        const raw = await fetchJson<RebasePage>(`${BASE}?por_pagina=50&pagina=${page}`, { headers });
        const jobs = parseRebase(raw);
        let fresh = 0;
        for (const job of jobs) {
          if (job.publishedAt && new Date(job.publishedAt) < since) continue;
          fresh++;
          seen.set(job.externalId, job);
        }
        // Ordered by date: a page with nothing fresh ends the walk.
        if (fresh === 0 || page >= (raw.meta?.paginas ?? page)) break;
        await sleep(PAGE_GAP_MS);
      }
      return [...seen.values()];
    },
  };
}
