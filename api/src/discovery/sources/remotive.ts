import { fetchJson } from "../http";
import type { NormalizedJob, Source } from "../model";
import { htmlToText } from "../text";

// One call per run. Filter parameters are ignored by the API (it returns the
// same small set either way), so everything is filtered locally downstream.

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

interface RemotiveResponse {
  jobs?: RemotiveJob[];
}

/** Remotive sends "2026-11-19T14:58:42" with no zone; it is UTC. */
function utc(date?: string): string | undefined {
  if (!date) return undefined;
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(date) ? date : `${date}Z`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function parseRemotive(response: RemotiveResponse): NormalizedJob[] {
  return (response.jobs ?? []).map((job) => {
    const location = (job.candidate_required_location ?? "").trim();
    return {
      source: "remotive",
      externalId: String(job.id),
      url: job.url,
      company: job.company_name,
      title: job.title,
      description: htmlToText(job.description ?? ""),
      locationRaw: location,
      tags: [...(job.category ? [job.category] : []), ...(job.tags ?? [])],
      salary: job.salary?.trim() || undefined,
      publishedAt: utc(job.publication_date),
      hints: [
        ...location.split(",").map((l) => l.trim()).filter(Boolean).map((l) => `location:${l}`),
        ...(job.category ? [`category:${job.category}`] : []),
        ...(job.job_type ? [`employment:${job.job_type}`] : []),
        "workplace:remote",
      ],
    };
  });
}

export function remotive(): Source {
  return {
    id: "remotive",
    async fetchJobs() {
      return parseRemotive(
        await fetchJson<RemotiveResponse>("https://remotive.com/api/remote-jobs?category=software-dev")
      );
    },
  };
}
