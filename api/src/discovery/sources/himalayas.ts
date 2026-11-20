import { fetchJson, sleep } from "../http";
import type { NormalizedJob, Source } from "../model";
import { htmlToText } from "../text";

// Uses /jobs/api/search?country=Brazil: Himalayas resolves location eligibility
// itself (jobs open to Brazil, worldwide ones included), which cuts the 100k+
// global feed to a few thousand. Search pages by ?page=N (no cursor); results can
// shift while paging, so jobs are de-duplicated on guid.

interface HimalayasJob {
  guid: string;
  title: string;
  companyName: string;
  description?: string;
  excerpt?: string;
  employmentType?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string | null;
  salaryPeriod?: string | null;
  seniority?: string[];
  locationRestrictions?: string[];
  timezoneRestrictions?: number[];
  categories?: string[];
  parentCategories?: string[];
  pubDate?: number;
  applicationLink?: string;
}

interface HimalayasPage {
  jobs?: HimalayasJob[];
}

const BASE = "https://himalayas.app/jobs/api/search";
/** Hard cap per run so a slow day never eats the Lambda's time. */
const MAX_PAGES = 30;
/** Spacing between pages, to stay polite under the rate limit. */
const PAGE_GAP_MS = 1_200;

function salaryOf(job: HimalayasJob): string | undefined {
  if (!job.minSalary && !job.maxSalary) return undefined;
  const range = [job.minSalary, job.maxSalary].filter(Boolean).join("–");
  return [job.currency, range, job.salaryPeriod ? `/${job.salaryPeriod}` : ""].filter(Boolean).join(" ").trim();
}

export function parseHimalayas(page: HimalayasPage): NormalizedJob[] {
  return (page.jobs ?? []).map((job) => {
    const locations = job.locationRestrictions ?? [];
    return {
      source: "himalayas",
      externalId: job.guid,
      url: job.applicationLink || job.guid,
      company: job.companyName,
      title: job.title,
      description: htmlToText(job.description ?? job.excerpt ?? ""),
      locationRaw: locations.length ? locations.join(", ") : "Worldwide",
      tags: [...(job.parentCategories ?? []), ...(job.categories ?? [])],
      salary: salaryOf(job),
      publishedAt: job.pubDate ? new Date(job.pubDate * 1000).toISOString() : undefined,
      hints: [
        ...(locations.length ? locations.map((l) => `location:${l}`) : ["location:Worldwide"]),
        ...(job.timezoneRestrictions ?? []).map((tz) => `timezone:${tz}`),
        ...(job.seniority ?? []).map((s) => `seniority:${s}`),
        ...(job.employmentType ? [`employment:${job.employmentType}`] : []),
        "workplace:remote",
      ],
    };
  });
}

export function himalayas(apiKey?: string): Source {
  return {
    id: "himalayas",
    async fetchJobs({ since }) {
      const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const seen = new Map<string, NormalizedJob>();

      for (let page = 1; page <= MAX_PAGES; page++) {
        const raw = await fetchJson<HimalayasPage>(
          `${BASE}?country=Brazil&sort=recent&page=${page}`,
          { headers }
        );
        const jobs = parseHimalayas(raw);
        if (jobs.length === 0) break;

        let fresh = 0;
        for (const job of jobs) {
          if (job.publishedAt && new Date(job.publishedAt) < since) continue;
          fresh++;
          seen.set(job.externalId, job);
        }
        // Page 1 opens with a few featured jobs out of date order; past it the
        // order is by date, so a page with nothing fresh ends the walk.
        if (fresh === 0 && page > 1) break;
        await sleep(PAGE_GAP_MS);
      }
      return [...seen.values()];
    },
  };
}
