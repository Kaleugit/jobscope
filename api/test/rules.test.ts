import { describe, expect, it } from "vitest";
import { applyRuleOutcome, evaluatePending } from "../src/discovery/evaluate";
import type { Company, DiscoveredJob } from "../src/discovery/model";
import {
  classifyLocation,
  evaluateRules,
  isAgency,
  isLocalMarket,
  judgeArea,
  judgeBarrier,
  judgeLatam,
  requiredYears,
} from "../src/discovery/rules";
import { memoryStore } from "../src/discovery/memory-store";

const job = (over: Partial<DiscoveredJob> = {}) => ({
  title: "Software Engineer",
  company: "Acme",
  locationRaw: "",
  hints: [] as string[],
  tags: [] as string[],
  salary: undefined as string | undefined,
  ...over,
});

describe("area pre-filter", () => {
  it.each([
    "Full Stack Developer",
    "Desenvolvedor Python Bilíngue",
    "Data Engineer",
    "QA Automation Engineer",
    "Sales Engineer",
    "Customer Support Engineer",
    "Implementation Specialist",
    "Analista de Implementação de Integrações Pleno",
    "AI Trainer (RLHF)",
    "Portuguese Language Expert (Brazil)",
    "Android Developer",
  ])("keeps %s", (title) => expect(judgeArea(title, []).ok).toBe(true));

  it.each([
    "Account Executive",
    "Technical Recruiter",
    "Financial Analyst",
    "Content Writer",
    "Product Designer",
    "Product Owner, AI Pod",
    "Embedded Firmware Engineer",
    "Unreal Engine Developer",
    "Don't see what you are looking for?",
    "General Application - Engineering",
    "Customer Success Manager",
  ])("drops %s", (title) => expect(judgeArea(title, []).ok).toBe(false));

  it("falls back to the source category when the title says little", () => {
    expect(judgeArea("Ninja", ["Developer"]).ok).toBe(true);
    expect(judgeArea("Ninja", ["Sales"]).ok).toBe(false);
  });
});

describe("location values", () => {
  it.each([
    ["Brazil", "latam"],
    ["Remote (Latin America, Europe)", "latam"],
    ["Americas Only", "latam"],
    ["LATAM, Europe, USA, Canada, APAC", "latam"],
    ["Worldwide", "worldwide"],
    ["Anywhere in the World", "worldwide"],
    ["Remote", "worldwide"],
    ["USA Only", "elsewhere"],
    ["Remote/Greece", "elsewhere"],
    ["Any State", "elsewhere"],
    ["Mexico", "elsewhere"],
  ] as const)("%s is %s", (value, expected) => expect(classifyLocation(value)).toBe(expected));
});

describe("LATAM layer 1", () => {
  describe("positive", () => {
    it("confirms on a structured LATAM location", () => {
      const v = judgeLatam(job({ hints: ["location:Brazil"] }), "Build things.");
      expect(v.bucket).toBe("confirmed");
    });

    it("confirms on a WWR region that includes Brazil", () => {
      expect(judgeLatam(job({ hints: ["region:Latin America Only"] }), "").bucket).toBe("confirmed");
    });

    it("confirms on a Lever country code BR", () => {
      expect(judgeLatam(job({ hints: ["country:BR"] }), "").bucket).toBe("confirmed");
    });

    it("treats worldwide as probable, not confirmed", () => {
      expect(judgeLatam(job({ hints: ["location:Worldwide"] }), "Anyone can apply.").bucket).toBe("likely");
    });
  });

  describe("negative (always wins)", () => {
    it.each([
      "This role is US only.",
      "Candidates must be authorized to work in the United States.",
      "Open to U.S. citizens.",
      "This is a W-2 position.",
      "EU only, sorry.",
      "Must be based in the UK.",
      "Requires an active security clearance.",
      "You must reside in Germany or Austria.",
      "You must reside in Mexico.",
    ])("discards: %s", (text) => {
      const v = judgeLatam(job({ hints: ["location:Worldwide"] }), text);
      expect(v.bucket).toBe("discarded");
    });

    it("beats a LATAM location in the structured field", () => {
      const v = judgeLatam(job({ hints: ["location:Latin America"] }), "Must be located in the US.");
      expect(v.bucket).toBe("discarded");
    });

    it("discards when every structured location is somewhere else", () => {
      expect(judgeLatam(job({ hints: ["region:USA Only"] }), "").bucket).toBe("discarded");
      expect(judgeLatam(job({ hints: ["location:Remote/Greece"] }), "").bucket).toBe("discarded");
    });

    it("does not read residence lines that name no place", () => {
      const v = judgeLatam(job({ hints: ["location:Worldwide"] }), "You must reside in a compatible timezone.");
      expect(v.bucket).toBe("likely");
    });

    it("lets residence in Brazil or LATAM through", () => {
      const v = judgeLatam(job({ hints: ["location:Worldwide"] }), "You must reside in Brazil or Argentina.");
      expect(v.bucket).toBe("likely");
    });
  });

  describe("location lines inside the description", () => {
    // Modern Health on WWR: region "Anywhere in the World", text "Locations: Remote - US".
    const modernHealth =
      "Headquarters: Remote - US\nWhile many roles may function from anywhere in the world, see each listing.\nLocations: Remote - US";

    it("a role's own Location line beats the board's region", () => {
      const v = judgeLatam(job({ hints: ["region:Anywhere in the World"] }), modernHealth);
      expect(v.bucket).toBe("discarded");
    });

    it("Headquarters alone is not a restriction", () => {
      const v = judgeLatam(job({ hints: ["region:Anywhere in the World"] }), "Headquarters: Remote - US\nWe hire everywhere.");
      expect(v.bucket).toBe("likely");
    });

    it("a line that also opens the role does not discard", () => {
      const text = "Location: US Based (Full-Time, Remote) or International Contractor (Full-Time, Remote)";
      expect(judgeLatam(job({ hints: ["location:Worldwide"] }), text).bucket).toBe("likely");
    });

    it("a line that names no place does not discard", () => {
      expect(judgeLatam(job({ hints: ["location:Worldwide"] }), "Location: About Hiredfy").bucket).toBe("likely");
    });

    it("a LATAM line confirms", () => {
      expect(judgeLatam(job(), "Location: LATAM-Remote").bucket).toBe("confirmed");
    });

    it("a restricting line against a structured LATAM field goes to the LLM", () => {
      expect(judgeLatam(job({ hints: ["location:Brazil"] }), "Location: Portugal, Remote").bucket).toBe("ambiguous");
    });
  });

  describe("ambiguous", () => {
    it("leaves a bare job with no location for the LLM", () => {
      expect(judgeLatam(job(), "We are a remote company.").bucket).toBe("ambiguous");
    });

    it("leaves a description-only LATAM mention for the LLM", () => {
      const v = judgeLatam(job(), "We have customers across Latin America.");
      expect(v.bucket).toBe("ambiguous");
    });
  });
});

describe("Experience Barrier", () => {
  it.each([
    ["5+ years of experience with Node.js", [5]],
    ["3-5 years of experience", [3]],
    ["3 to 5 years of professional experience", [3]],
    ["At least five years building APIs", [5]],
    ["Minimum 4 years in software development", [4]],
    ["5 anos de experiência com Java", [5]],
  ])("reads '%s'", (text, expected) => {
    expect(requiredYears(text)).toEqual(expected);
  });

  it("reads Spanish años (folds to anos)", () => {
    expect(requiredYears("Experiencia mínimo 8 años en desarrollo")).toEqual([8]);
  });

  it.each([
    "Founded 10 years ago, we serve millions.",
    "Over the past 5 years we grew tenfold.",
    "In 3 years we want to be global.",
  ])("ignores company history: '%s'", (text) => expect(requiredYears(text)).toEqual([]));

  it("blocks above the owner's years, passes at or below", () => {
    expect(judgeBarrier(job(), "3+ years of experience", 3).blocked).toBe(false);
    expect(judgeBarrier(job(), "4+ years of experience", 3).blocked).toBe(true);
  });

  it("any number above counts, even for one technology", () => {
    expect(judgeBarrier(job(), "3+ years of experience; 5+ years of React", 3).blocked).toBe(true);
  });

  it.each(["Senior Backend Engineer", "Sr. Developer", "Staff Engineer", "Principal Engineer", "Tech Lead", "Engineering Manager", "Desenvolvedor Sênior", "Pessoa Desenvolvedora Especialista", "Arquiteto de Soluções", "Software Engineer III"])(
    "blocks every senior level: %s",
    (title) => expect(judgeBarrier(job({ title }), "", 3).blocked).toBe(true)
  );

  it("blocks when the source marks the job senior only", () => {
    expect(judgeBarrier(job({ hints: ["seniority:Senior"] }), "", 3).blocked).toBe(true);
    expect(judgeBarrier(job({ hints: ["seniority:Mid-level", "seniority:Senior"] }), "", 3).blocked).toBe(false);
  });

  it("lets mid-level and junior titles through", () => {
    expect(judgeBarrier(job({ title: "Mid-Level Software Engineer" }), "", 3).blocked).toBe(false);
    expect(judgeBarrier(job({ title: "Desenvolvedor Java Pleno" }), "", 3).blocked).toBe(false);
  });
});

describe("Local Market and Agency", () => {
  it("spots a Brazilian job in reais", () => {
    expect(isLocalMarket("Dev", "Salário de R$ 8.000 em regime CLT")).toBe(true);
    expect(isLocalMarket("Desenvolvedor", "Buscamos pessoa desenvolvedora para atuar com nossa equipe de dados, com experiência em Python e conhecimento de SQL para a vaga.")).toBe(true);
    expect(isLocalMarket("Engineer", "We are hiring an engineer to work with our team on APIs.")).toBe(false);
  });

  it("spots agencies by name, phrase or Lever client team", () => {
    expect(isAgency("CodeRoad", "", [])).toBe(true);
    expect(isAgency("Acme", "You will join one of our clients in the US.", [])).toBe(true);
    expect(isAgency("Acme", "", ["Client - Healthcare Platform"])).toBe(true);
    expect(isAgency("Acme", "We build our own product.", [])).toBe(false);
  });
});

describe("whole outcome", () => {
  it("the first filter that fires is the discard reason", () => {
    const r = evaluateRules(job({ title: "Senior Account Executive" }), "", 3);
    expect(r.discardReason).toMatch(/área/);
    expect(r.needsLlm).toBe(false);
  });

  it("hybrid jobs are not remote", () => {
    const r = evaluateRules(job({ hints: ["workplace:hybrid", "location:Brazil"] }), "", 3);
    expect(r.discardReason).toMatch(/não é remota/);
  });

  it("a mid-level LATAM engineering job goes to the LLM", () => {
    const r = evaluateRules(job({ hints: ["location:Brazil"] }), "3+ years of experience with TypeScript.", 3);
    expect(r.needsLlm).toBe(true);
    expect(r.latam.bucket).toBe("confirmed");
  });
});

describe("evaluatePending", () => {
  it("persists outcomes and counts companies once", async () => {
    const { store, items } = memoryStore();
    const company: Company = {
      pk: "DISC#COMPANY", sk: "greenhouse#coderoad", ats: "greenhouse", token: "coderoad", name: "Coderoad",
      active: true, totalJobsSeen: 0, latamJobsSeen: 0, createdAt: "", updatedAt: "",
    };
    await store.put(company);
    const base = {
      pk: "DISC#JOB", sk: "k1", jobKey: "k1", gsi1pk: "DISC#JOBS", gsi1sk: "x", company: "Coderoad",
      title: "Data Engineer", locationRaw: "Latin America", tags: [], publishedAt: "", firstSeenAt: "",
      lastSeenAt: "", sources: [{ source: "greenhouse:coderoad", externalId: "1", url: "https://x" }],
      hints: ["location:Latin America"], descriptionSource: "", descriptionHash: "", needsEvaluation: true,
      llmStatus: "pending", triage: "new", triageHistory: [],
    } as unknown as DiscoveredJob;

    const first = await evaluatePending(store, [base], 3);
    expect(first.toLlm).toBe(1);
    expect(items.get("DISC#COMPANY|greenhouse#coderoad")?.latamJobsSeen).toBe(1);

    // Re-judging a changed description does not count the job twice.
    await evaluatePending(store, [{ ...first.jobs[0], needsEvaluation: true }], 3);
    expect(items.get("DISC#COMPANY|greenhouse#coderoad")?.totalJobsSeen).toBe(1);
  });

  it("clears an old score when the job is now discarded", () => {
    const scored = { score: 90, scoreReason: "x", llmStatus: "done" } as unknown as DiscoveredJob;
    const next = applyRuleOutcome(scored, evaluateRules(job({ title: "Senior Engineer" }), "", 3));
    expect(next.score).toBeUndefined();
    expect(next.llmStatus).toBe("not_needed");
  });

  it("deletes a discarded job at once and leaves only its fingerprint", async () => {
    const { store, get } = memoryStore();
    const job = {
      pk: "DISC#JOB", sk: "k9", jobKey: "k9", gsi1pk: "DISC#JOBS", gsi1sk: "x", company: "Acme",
      title: "Senior Engineer", locationRaw: "", tags: [], publishedAt: "2026-11-20T00:00:00.000Z",
      firstSeenAt: "", lastSeenAt: "", sources: [], hints: [], descriptionSource: "", descriptionHash: "",
      needsEvaluation: true, llmStatus: "pending", triage: "new", triageHistory: [],
    } as unknown as DiscoveredJob;
    await store.put(job);
    await store.put({ pk: "DISC#JOBDESC", sk: "k9", description: "x" });
    const result = await evaluatePending(store, [job], 3);
    expect(result.discarded).toBe(1);
    expect(get("DISC#JOB", "k9")).toBeUndefined();
    expect(get("DISC#JOBDESC", "k9")).toBeUndefined();
    const fingerprint = get("DISC#GONE", "k9");
    expect(fingerprint).toBeDefined();
    expect(Object.keys(fingerprint!).sort()).toEqual(["pk", "sk", "ttl"]);
  });
});
