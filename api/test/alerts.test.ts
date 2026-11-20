import { describe, expect, it } from "vitest";
import { alertable, renderAlert } from "../src/discovery/alerts";
import type { DiscoveredJob } from "../src/discovery/model";

const now = new Date("2026-11-21T10:00:00.000Z");

const job = (over: Partial<DiscoveredJob> = {}): DiscoveredJob =>
  ({
    pk: "DISC#JOB",
    sk: "k",
    jobKey: "k",
    company: "Acme",
    title: "Product Engineer",
    publishedAt: "2026-11-21T06:00:00.000Z",
    lastSeenAt: "2026-11-21T06:00:00.000Z",
    sources: [{ source: "himalayas", externalId: "1", url: "https://example.com/job" }],
    latam: { bucket: "confirmed", decidedBy: "rule", evidence: "localização: Brazil" },
    llmStatus: "done",
    score: 90,
    scoreReason: "Ownership e IA.",
    triage: "new",
    ...over,
  }) as DiscoveredJob;

describe("alertable", () => {
  it("a fresh, confirmed, international job above the limit", () => {
    expect(alertable(job(), 80, now)).toBe(true);
  });

  it.each([
    ["below the limit", { score: 79 }],
    ["only probable LATAM", { latam: { bucket: "likely", decidedBy: "rule", evidence: "" } }],
    ["Local Market", { localMarket: true }],
    ["already alerted", { alertedAt: "2026-11-21T07:00:00.000Z" }],
    ["discarded", { discardReason: "x" }],
    ["not scored yet", { llmStatus: "pending" }],
    ["sent to review", { llmStatus: "review" }],
    ["already promoted by the owner", { triage: "promoted" }],
    ["older than 48h", { publishedAt: "2026-11-18T09:00:00.000Z" }],
  ] as const)("not when %s", (_label, over) => {
    expect(alertable(job(over as Partial<DiscoveredJob>), 80, now)).toBe(false);
  });
});

describe("renderAlert", () => {
  it("lists the highest score first and links the original posting", () => {
    const { subject, html, text } = renderAlert([job({ score: 82, title: "B" }), job({ score: 95, title: "A <script>" })]);
    expect(subject).toMatch(/^2 vagas/);
    expect(html.indexOf("A &lt;script&gt;")).toBeLessThan(html.indexOf(">B<"));
    expect(html).not.toContain("<script>");
    expect(text).toContain("https://example.com/job");
  });
});
