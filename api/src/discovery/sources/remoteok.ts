import { fetchJson } from "../http";
import type { NormalizedJob, Source } from "../model";
import { htmlToText } from "../text";

// The first array element is a legal notice, not a job. The feed is a window of
// roughly the 100 most recent jobs. Some entries are not really remote ("Paris",
// "Boston"); the location goes out as a hint and the filters decide.

interface RemoteOkJob {
  id?: string;
  slug?: string;
  epoch?: number;
  date?: string;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  url?: string;
  apply_url?: string;
}

function salaryOf(job: RemoteOkJob): string | undefined {
  const min = job.salary_min ?? 0;
  const max = job.salary_max ?? 0;
  if (!min && !max) return undefined;
  return `USD ${[min, max].filter(Boolean).join("–")} /year`;
}

export function parseRemoteOk(items: RemoteOkJob[]): NormalizedJob[] {
  return items
    .filter((item) => item.id && item.position && item.company)
    .map((job) => {
      const location = (job.location ?? "").trim();
      return {
        source: "remoteok",
        externalId: String(job.id),
        url: job.url || job.apply_url || `https://remoteok.com/remote-jobs/${job.slug}`,
        company: job.company!,
        title: job.position!,
        description: htmlToText(job.description ?? ""),
        locationRaw: location,
        tags: job.tags ?? [],
        salary: salaryOf(job),
        publishedAt: job.epoch
          ? new Date(job.epoch * 1000).toISOString()
          : job.date
            ? new Date(job.date).toISOString()
            : undefined,
        hints: [...(location ? [`location:${location}`] : []), ...(job.tags ?? []).map((t) => `tag:${t}`)],
      };
    });
}

export function remoteOk(): Source {
  return {
    id: "remoteok",
    async fetchJobs() {
      return parseRemoteOk(await fetchJson<RemoteOkJob[]>("https://remoteok.com/api"));
    },
  };
}
