import { describe, expect, it } from "vitest";
import type { DiscoveredJob } from "../src/discovery/model";
import { viewOf, windowStart } from "../src/discovery/routes";

describe("windowStart", () => {
  it("'today' starts at midnight in Brazil, not UTC", () => {
    // 01:30 UTC on the 21st is still 22:30 on the 20th in São Paulo.
    expect(windowStart("today", new Date("2026-11-21T01:30:00.000Z")).toISOString()).toBe("2026-11-20T03:00:00.000Z");
    expect(windowStart("today", new Date("2026-11-21T15:00:00.000Z")).toISOString()).toBe("2026-11-21T03:00:00.000Z");
  });

  it("rolling windows count back from now", () => {
    const now = new Date("2026-11-21T15:00:00.000Z");
    expect(windowStart("24h", now).toISOString()).toBe("2026-11-20T15:00:00.000Z");
    expect(windowStart("48h", now).toISOString()).toBe("2026-11-19T15:00:00.000Z");
  });
});

describe("viewOf", () => {
  const job = (over: Partial<DiscoveredJob>) => ({ llmStatus: "done", ...over }) as DiscoveredJob;
  it("sorts jobs into the panel's tabs", () => {
    expect(viewOf(job({}))).toBe("main");
    expect(viewOf(job({ llmStatus: "review" }))).toBe("review");
    expect(viewOf(job({ llmStatus: "pending" }))).toBe("pending");
    expect(viewOf(job({ discardReason: "x", llmStatus: "not_needed" }))).toBe("discarded");
  });
});
