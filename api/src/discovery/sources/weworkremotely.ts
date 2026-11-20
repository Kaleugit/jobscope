import { fetchText, sleep } from "../http";
import type { NormalizedJob, Source } from "../model";
import { decodeEntities, htmlToText } from "../text";

// RSS, one feed per programming category (the main feed mixes every area).
// Titles come as "Company: Role". Each item carries a <region>.

const FEEDS = [
  "remote-full-stack-programming-jobs",
  "remote-back-end-programming-jobs",
  "remote-front-end-programming-jobs",
  "remote-programming-jobs",
  "remote-devops-sysadmin-jobs",
];

function tag(item: string, name: string): string {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  if (!match) return "";
  const raw = match[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return cdata ? cdata[1] : decodeEntities(raw);
}

/** "Cribl: Staff Software Engineer, Search Core" -> company, title. Splits on the first colon only. */
export function splitWwrTitle(full: string): { company: string; title: string } {
  const index = full.indexOf(":");
  if (index <= 0) return { company: "", title: full.trim() };
  return { company: full.slice(0, index).trim(), title: full.slice(index + 1).trim() };
}

export function parseWwrRss(xml: string): NormalizedJob[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.map((item) => {
    const { company, title } = splitWwrTitle(tag(item, "title"));
    const region = tag(item, "region");
    const country = tag(item, "country");
    const category = tag(item, "category");
    const type = tag(item, "type");
    const link = tag(item, "link") || tag(item, "guid");
    const pubDate = tag(item, "pubDate");
    const parsedDate = pubDate ? new Date(pubDate) : undefined;
    return {
      source: "weworkremotely",
      externalId: tag(item, "guid") || link,
      url: link,
      company,
      title,
      description: htmlToText(tag(item, "description")),
      locationRaw: [region, country].filter(Boolean).join(", "),
      tags: [category, ...tag(item, "skills").split(",")].map((t) => t.trim()).filter(Boolean),
      publishedAt:
        parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : undefined,
      hints: [
        ...(region ? [`region:${region}`] : []),
        ...(country ? [`location:${country}`] : []),
        ...(category ? [`category:${category}`] : []),
        ...(type ? [`employment:${type}`] : []),
        "workplace:remote",
      ],
    };
  });
}

export function weWorkRemotely(): Source {
  return {
    id: "weworkremotely",
    async fetchJobs() {
      const byId = new Map<string, NormalizedJob>();
      for (const feed of FEEDS) {
        const xml = await fetchText(`https://weworkremotely.com/categories/${feed}.rss`);
        for (const job of parseWwrRss(xml)) byId.set(job.externalId, job);
        await sleep(500);
      }
      return [...byId.values()];
    },
  };
}
