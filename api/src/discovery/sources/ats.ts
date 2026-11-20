import { fetchJson } from "../http";
import type { AtsKind, Company, NormalizedJob, Source, SourceId } from "../model";
import { htmlToText } from "../text";

// Public ATS boards. One connector per ATS; each company row in the table
// becomes one Source, so adding a company is adding a row.

// ── Greenhouse ───────────────────────────────────────────────────────────

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  content?: string;
  location?: { name?: string };
  offices?: { name?: string }[];
  first_published?: string;
  updated_at?: string;
}

export function parseGreenhouse(
  response: { jobs?: GreenhouseJob[] },
  company: string,
  source: SourceId
): NormalizedJob[] {
  return (response.jobs ?? []).map((job) => {
    const location = job.location?.name?.trim() ?? "";
    const offices = (job.offices ?? []).map((o) => o.name?.trim()).filter(Boolean) as string[];
    const published = job.first_published ?? job.updated_at;
    return {
      source,
      externalId: String(job.id),
      url: job.absolute_url,
      company,
      title: job.title,
      description: htmlToText(job.content ?? ""),
      locationRaw: location,
      tags: [],
      publishedAt: published ? new Date(published).toISOString() : undefined,
      hints: [
        ...(location ? [`location:${location}`] : []),
        ...offices.map((o) => `office:${o}`),
      ],
    };
  });
}

// ── Lever ────────────────────────────────────────────────────────────────

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  country?: string;
  workplaceType?: string;
  descriptionPlain?: string;
  additionalPlain?: string;
  lists?: { text?: string; content?: string }[];
  categories?: { location?: string; allLocations?: string[]; commitment?: string; team?: string };
}

export function parseLever(postings: LeverPosting[], company: string, source: SourceId): NormalizedJob[] {
  return postings.map((posting) => {
    const locations = posting.categories?.allLocations?.length
      ? posting.categories.allLocations
      : posting.categories?.location
        ? [posting.categories.location]
        : [];
    // Lever keeps requirements in "lists"; without them the description misses
    // exactly the lines that state years and location.
    const lists = (posting.lists ?? [])
      .map((list) => `${list.text ?? ""}\n${htmlToText(list.content ?? "")}`.trim())
      .filter(Boolean);
    return {
      source,
      externalId: posting.id,
      url: posting.hostedUrl,
      company,
      title: posting.text,
      description: [posting.descriptionPlain ?? "", ...lists, posting.additionalPlain ?? ""]
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n\n"),
      locationRaw: locations.join(", "),
      tags: posting.categories?.team ? [posting.categories.team] : [],
      publishedAt: posting.createdAt ? new Date(posting.createdAt).toISOString() : undefined,
      hints: [
        ...locations.map((l) => `location:${l}`),
        ...(posting.country ? [`country:${posting.country}`] : []),
        ...(posting.workplaceType ? [`workplace:${posting.workplaceType}`] : []),
        ...(posting.categories?.commitment ? [`employment:${posting.categories.commitment}`] : []),
      ],
    };
  });
}

// ── Ashby ────────────────────────────────────────────────────────────────

interface AshbyJob {
  id: string;
  title: string;
  jobUrl: string;
  location?: string;
  secondaryLocations?: { location?: string }[] | string[];
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: string;
  employmentType?: string;
  publishedAt?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  address?: { postalAddress?: { addressCountry?: string } };
}

export function parseAshby(response: { jobs?: AshbyJob[] }, company: string, source: SourceId): NormalizedJob[] {
  return (response.jobs ?? [])
    .filter((job) => job.isListed !== false)
    .map((job) => {
      const secondary = (job.secondaryLocations ?? [])
        .map((s) => (typeof s === "string" ? s : s.location))
        .filter(Boolean) as string[];
      const locations = [job.location, ...secondary].filter(Boolean) as string[];
      const country = job.address?.postalAddress?.addressCountry;
      return {
        source,
        externalId: job.id,
        url: job.jobUrl,
        company,
        title: job.title,
        description: job.descriptionPlain?.trim() || htmlToText(job.descriptionHtml ?? ""),
        locationRaw: locations.join(", "),
        tags: [],
        publishedAt: job.publishedAt ? new Date(job.publishedAt).toISOString() : undefined,
        hints: [
          ...locations.map((l) => `location:${l}`),
          ...(country ? [`country:${country}`] : []),
          ...(job.workplaceType ? [`workplace:${job.workplaceType}`] : []),
          ...(job.isRemote ? ["workplace:remote"] : []),
          ...(job.employmentType ? [`employment:${job.employmentType}`] : []),
        ],
      };
    });
}

// ── Factory ──────────────────────────────────────────────────────────────

const ENDPOINTS: Record<AtsKind, (token: string) => string> = {
  greenhouse: (t) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(t)}/jobs?content=true`,
  lever: (t) => `https://api.lever.co/v0/postings/${encodeURIComponent(t)}?mode=json`,
  ashby: (t) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(t)}`,
};

export function atsSource(company: Pick<Company, "ats" | "token" | "name">): Source {
  const id = `${company.ats}:${company.token}` as SourceId;
  return {
    id,
    async fetchJobs() {
      const raw = await fetchJson<unknown>(ENDPOINTS[company.ats](company.token));
      switch (company.ats) {
        case "greenhouse":
          return parseGreenhouse(raw as { jobs?: GreenhouseJob[] }, company.name, id);
        case "lever":
          return parseLever(raw as LeverPosting[], company.name, id);
        case "ashby":
          return parseAshby(raw as { jobs?: AshbyJob[] }, company.name, id);
      }
    },
  };
}
