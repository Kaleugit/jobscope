import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NormalizedJob } from "../src/discovery/model";
import { parseAshby, parseGreenhouse, parseLever } from "../src/discovery/sources/ats";
import { parseHimalayas } from "../src/discovery/sources/himalayas";
import { parseRemoteOk } from "../src/discovery/sources/remoteok";
import { parseRemotive } from "../src/discovery/sources/remotive";
import { parseFourDayWeek } from "../src/discovery/sources/fourdayweek";
import { parseRebase } from "../src/discovery/sources/rebase";
import { evaluateRules } from "../src/discovery/rules";

// Fixtures are real responses captured on 2026-11-20, trimmed to a few items
// with descriptions cut short (this repo is public; jobs are not republished).
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf-8");
const json = (name: string) => JSON.parse(fixture(name));

function expectWellFormed(jobs: NormalizedJob[]) {
  expect(jobs.length).toBeGreaterThan(0);
  for (const job of jobs) {
    expect(job.externalId).toBeTruthy();
    expect(job.url).toMatch(/^https?:\/\//);
    expect(job.company).toBeTruthy();
    expect(job.title).toBeTruthy();
    // Clean text: no tags, no escaped tags left behind.
    expect(job.description).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(job.description).not.toMatch(/&lt;|&gt;|&amp;/);
    if (job.publishedAt) expect(Number.isNaN(Date.parse(job.publishedAt))).toBe(false);
  }
}

describe("himalayas", () => {
  const jobs = parseHimalayas(json("himalayas.json"));

  it("normalizes every job", () => expectWellFormed(jobs));

  it("treats no location restriction as worldwide", () => {
    const open = jobs.filter((j) => j.hints.includes("location:Worldwide"));
    expect(open.length).toBeGreaterThan(0);
    for (const job of open) expect(job.locationRaw).toBe("Worldwide");
  });

  it("keeps country restrictions, seniority and timezones as hints", () => {
    const brazil = jobs.find((j) => j.hints.includes("location:Brazil"));
    expect(brazil).toBeDefined();
    expect(jobs.some((j) => j.hints.some((h) => h.startsWith("seniority:")))).toBe(true);
  });

  it("converts the epoch-seconds pubDate", () => {
    expect(jobs[0].publishedAt?.startsWith("2026-")).toBe(true);
  });
});

describe("remotive", () => {
  const jobs = parseRemotive(json("remotive.json"));

  it("normalizes every job", () => expectWellFormed(jobs));

  it("reads the zoneless publication date as UTC", () => {
    const raw = json("remotive.json").jobs[0].publication_date as string;
    expect(jobs[0].publishedAt).toBe(new Date(`${raw}Z`).toISOString());
  });

  it("splits candidate_required_location into hints", () => {
    const multi = jobs.find((j) => j.locationRaw.includes(","));
    expect(multi).toBeDefined();
    expect(multi!.hints.filter((h) => h.startsWith("location:")).length).toBeGreaterThan(1);
  });
});

describe("remote ok", () => {
  const raw = json("remoteok.json");
  const jobs = parseRemoteOk(raw);

  it("skips the legal notice in the first element", () => {
    expect(raw[0].legal).toBeDefined();
    expect(jobs).toHaveLength(raw.length - 1);
  });

  it("normalizes every job", () => expectWellFormed(jobs));
});

describe("greenhouse", () => {
  const jobs = parseGreenhouse(json("greenhouse.json"), "Coderoad", "greenhouse:coderoad");

  it("normalizes every job, unescaping the double-escaped content", () => expectWellFormed(jobs));

  it("uses the board's location name", () => {
    expect(jobs[0].locationRaw).toBe("Latin America");
    expect(jobs[0].source).toBe("greenhouse:coderoad");
  });
});

describe("lever", () => {
  const jobs = parseLever(json("lever.json"), "JetBridge", "lever:JetBridge");

  it("normalizes every posting", () => expectWellFormed(jobs));

  it("keeps workplace type and country, so hybrid postings can be dropped", () => {
    expect(jobs.some((j) => j.hints.includes("workplace:hybrid"))).toBe(true);
    expect(jobs.some((j) => j.hints.includes("country:BR"))).toBe(true);
  });
});

describe("ashby", () => {
  const jobs = parseAshby(json("ashby.json"), "Connectly", "ashby:connectly");

  it("normalizes every listed job", () => expectWellFormed(jobs));

  it("keeps the location string", () => {
    expect(jobs.map((j) => j.locationRaw)).toContain("Remote/Brazil");
  });
});

// Captured on 2026-11-24, trimmed the same way.
describe("rebase", () => {
  const jobs = parseRebase(json("rebase.json"));

  it("normalizes every job", () => expectWellFormed(jobs));

  it("links straight to the company's ATS, not the catalog page", () => {
    for (const job of jobs) expect(job.url).not.toContain("rebasedev.com.br");
  });

  it("turns the catalog's Brazil verdict into a confirmed LATAM", () => {
    for (const job of jobs) {
      expect(job.hints).toContain("country:brazil");
      expect(job.hints).toContain("workplace:remote");
    }
    const multi = jobs.find((j) => j.locationRaw.includes(","));
    expect(multi?.hints.filter((h) => h.startsWith("location:")).length).toBeGreaterThan(1);
  });

  it("drops closed jobs", () => {
    const raw = json("rebase.json");
    raw.data[0].closed_at = "2026-11-24T00:00:00Z";
    expect(parseRebase(raw)).toHaveLength(jobs.length - 1);
  });
});

describe("4dayweek", () => {
  const jobs = parseFourDayWeek(json("4dayweek.json"));

  it("normalizes every job", () => expectWellFormed(jobs));

  it("keeps countries as location hints, so Brazil reads as LATAM", () => {
    for (const job of jobs) expect(job.hints).toContain("location:Brazil");
    const outcome = evaluateRules(jobs[0], jobs[0].description, 3);
    expect(outcome.latam.bucket).not.toBe("discarded");
  });

  it("converts salaries from cents", () => {
    const raw = json("4dayweek.json");
    raw.data[0] = { ...raw.data[0], salary_min: 8_000_000, salary_max: 12_000_000, salary_currency: "USD", salary_period: "year" };
    expect(parseFourDayWeek(raw)[0].salary).toBe("USD 80000–120000 /year");
  });
});
