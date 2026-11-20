import { describe, expect, it } from "vitest";
import {
  descriptionHash,
  htmlToText,
  jobKeyFor,
  normalizeCompany,
  normalizeTitle,
} from "../src/discovery/text";

describe("htmlToText", () => {
  it("strips tags and keeps paragraph breaks", () => {
    expect(htmlToText("<p>Hello <b>world</b></p><p>Next</p>")).toBe("Hello world\nNext");
  });

  it("unescapes double-escaped HTML before stripping", () => {
    expect(htmlToText("&lt;p&gt;Build &amp;amp; ship&lt;/p&gt;")).toBe("Build & ship");
  });

  it("turns list items into bullets", () => {
    expect(htmlToText("<ul><li>One</li><li>Two</li></ul>")).toBe("• One\n• Two");
  });

  it("drops scripts and styles", () => {
    expect(htmlToText("<style>p{}</style><p>Text</p><script>x()</script>")).toBe("Text");
  });
});

describe("dedup normalization", () => {
  it("removes accents, case and punctuation", () => {
    expect(normalizeTitle("Desenvolvedor(a) Sênior!")).toBe(normalizeTitle("desenvolvedor a senior"));
  });

  it.each([
    ["Backend Engineer (Remote)", "Backend Engineer"],
    ["Backend Engineer - Remote", "Backend Engineer"],
    ["Backend Engineer - Remote, LATAM", "Backend Engineer"],
    ["Backend Engineer | Brazil", "Backend Engineer"],
    ["Backend Engineer [LATAM]", "Backend Engineer"],
    ["Backend Engineer – Latin America", "Backend Engineer"],
    ["Remote - Backend Engineer", "Backend Engineer"],
    ["Backend Engineer in Brazil", "Backend Engineer"],
  ])("'%s' matches '%s'", (decorated, plain) => {
    expect(normalizeTitle(decorated)).toBe(normalizeTitle(plain));
  });

  it("keeps suffixes that are part of the role", () => {
    expect(normalizeTitle("Engineer - Backend")).not.toBe(normalizeTitle("Engineer"));
    expect(normalizeTitle("Software Engineer, Payments")).not.toBe(normalizeTitle("Software Engineer"));
  });

  it("ignores legal suffixes in company names", () => {
    expect(normalizeCompany("Acme, Inc.")).toBe(normalizeCompany("ACME"));
    expect(normalizeCompany("Empresa Ltda")).toBe(normalizeCompany("Empresa"));
  });

  it("gives the same key across sources", () => {
    expect(jobKeyFor("CodeRoad", "Agentic AI Engineer (Remote)")).toBe(
      jobKeyFor("Coderoad", "Agentic AI Engineer - LATAM")
    );
  });

  it("hashes descriptions ignoring whitespace only", () => {
    expect(descriptionHash("a  b\n c")).toBe(descriptionHash("a b c"));
    expect(descriptionHash("a b c")).not.toBe(descriptionHash("a b d"));
  });
});
