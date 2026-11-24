import { fetchJson, sleep } from "../http";
import type { NormalizedJob, Source } from "../model";
import { htmlToText } from "../text";

// 4dayweek.io public API v2 (no key, 60 calls a minute per IP, robots.txt
// allows /api/v2). country=Brazil matches the office or a remote-allowed
// country, so the board resolves eligibility; posted_after trims by age.
// The API no longer gives the apply link: url is the job page on 4dayweek.io.

interface FourDayLocation {
  city?: string | null;
  country?: string | null;
  continent?: string | null;
  work_arrangement?: string | null;
}

interface FourDayJob {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  url: string;
  category?: string | null;
  level?: string | null;
  contract_type?: string | null;
  schedule_type?: string | null;
  work_arrangement?: string | null;
  locations?: FourDayLocation[];
  timezones?: string[];
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_period?: string | null;
  stack?: { slug: string }[];
  skills?: { slug: string }[];
  posted_at?: string | null;
  company?: { name?: string };
}

interface FourDayPage {
  data?: FourDayJob[];
  has_more?: boolean;
}

const BASE = "https://4dayweek.io/api/v2/jobs";
const MAX_PAGES = 10;
const PAGE_GAP_MS = 1_200;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A listing can reach the API up to 48h after its posted_at: look back further. */
const LATE_MS = 3 * DAY_MS;

/** Salaries come in cents. */
function salaryOf(job: FourDayJob): string | undefined {
  const range = [job.salary_min, job.salary_max].filter((v): v is number => Boolean(v)).map((v) => Math.round(v / 100));
  if (range.length === 0) return undefined;
  return [job.salary_currency, range.join("–"), job.salary_period ? `/${job.salary_period}` : ""].filter(Boolean).join(" ").trim();
}

export function parseFourDayWeek(page: FourDayPage): NormalizedJob[] {
  return (page.data ?? []).map((job) => {
    const places = [...new Set((job.locations ?? []).map((l) => l.country || l.continent).filter((p): p is string => Boolean(p)))];
    return {
      source: "4dayweek",
      externalId: job.id,
      url: job.url,
      company: job.company?.name ?? "",
      title: job.title,
      description: htmlToText(job.description ?? ""),
      locationRaw: places.join(", "),
      tags: [
        ...(job.category ? [job.category] : []),
        ...(job.stack ?? []).map((s) => s.slug),
        ...(job.skills ?? []).map((s) => s.slug),
      ],
      salary: salaryOf(job),
      publishedAt: job.posted_at ?? undefined,
      hints: [
        ...places.map((p) => `location:${p}`),
        ...(job.level ? [`seniority:${job.level}`] : []),
        ...(job.contract_type ? [`employment:${job.contract_type}`] : []),
        ...(job.schedule_type ? [`schedule:${job.schedule_type}`] : []),
        ...(job.work_arrangement ? [`workplace:${job.work_arrangement}`] : []),
      ],
    };
  });
}

export function fourDayWeek(): Source {
  return {
    id: "4dayweek",
    async fetchJobs(ctx) {
      const since = new Date(ctx.since.getTime() - LATE_MS);
      const days = Math.min(365, Math.max(1, Math.ceil((Date.now() - since.getTime()) / DAY_MS)));
      const seen = new Map<string, NormalizedJob>();
      for (let page = 1; page <= MAX_PAGES; page++) {
        const raw = await fetchJson<FourDayPage>(
          `${BASE}?country=Brazil&work_arrangement=remote&posted_after=${days}&limit=100&page=${page}`
        );
        for (const job of parseFourDayWeek(raw)) {
          if (job.publishedAt && new Date(job.publishedAt) < since) continue;
          seen.set(job.externalId, job);
        }
        if (!raw.has_more) break;
        await sleep(PAGE_GAP_MS);
      }
      return [...seen.values()];
    },
  };
}
