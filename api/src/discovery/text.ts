import { createHash } from "node:crypto";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const BLOCK_TAGS = /<\/?(p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|blockquote|pre)\b[^>]*>/gi;

/** HTML to clean plain text. Some sources escape their HTML once more
 *  (Greenhouse sends "&lt;p&gt;"), so entities are decoded before tags go. */
export function htmlToText(html: string): string {
  let text = html;
  if (/&lt;[a-z/!]/i.test(text)) text = decodeEntities(text);
  text = text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(BLOCK_TAGS, "\n")
    .replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  return text
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Lowercase, no accents, no punctuation, single spaces. */
export function foldText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Words that, after a separator or inside brackets, only say where or how the
// job is done. "Backend Engineer - Remote LATAM" and "Backend Engineer" are the
// same job; "Engineer - Backend" keeps its suffix because "backend" is not here.
const LOCATION_WORDS = [
  "remote", "remoto", "remota", "hybrid", "home office", "anywhere", "worldwide", "global",
  "latam", "latin america", "south america", "americas", "north america", "brazil", "brasil",
  "argentina", "mexico", "colombia", "chile", "uruguay", "peru",
  "us", "usa", "united states", "canada", "europe", "emea", "apac", "uk",
  "contract", "contractor", "full time", "fulltime", "part time", "freelance",
  "est", "pst", "cet", "utc",
];

function isLocationPhrase(phrase: string): boolean {
  const words = foldText(phrase);
  if (!words) return true;
  // Every token belongs to some location phrase ("remote latam", "brazil or mexico").
  let rest = ` ${words} `;
  for (const word of [...LOCATION_WORDS].sort((a, b) => b.length - a.length)) {
    rest = rest.split(` ${word} `).join(" ");
  }
  return rest.replace(/\b(or|and|only|based|from|in|time|zone|timezone|friendly|first)\b/g, "").trim() === "";
}

/** Title without its location/remote decorations, used for cross-source dedup. */
export function stripTitleDecorations(title: string): string {
  let t = title.trim();
  // Bracketed decorations anywhere: "(Remote)", "[LATAM]".
  t = t.replace(/[([]([^)\]]*)[)\]]/g, (match, inner: string) =>
    isLocationPhrase(inner) ? " " : match
  );
  // Trailing " - Remote", " | LATAM", ", Brazil", " – Worldwide": peel repeatedly.
  for (;;) {
    const m = t.match(/^(.*\S)\s*(?:[-–—|,:/]|\bin\b)\s*([^-–—|,:/]+)$/);
    if (!m || !isLocationPhrase(m[2])) break;
    t = m[1];
  }
  // Leading "Remote - ", "LATAM | ".
  for (;;) {
    const m = t.match(/^([^-–—|:/]+?)\s*[-–—|:/]\s*(.+)$/);
    if (!m || !isLocationPhrase(m[1])) break;
    t = m[2];
  }
  return t.trim();
}

const COMPANY_SUFFIXES = /\b(inc|llc|ltd|ltda|limited|corp|corporation|co|gmbh|sa|s a|bv|plc|sas|srl|me|eireli)\b/g;

export function normalizeCompany(company: string): string {
  return foldText(company).replace(COMPANY_SUFFIXES, " ").replace(/\s+/g, " ").trim();
}

export function normalizeTitle(title: string): string {
  return foldText(stripTitleDecorations(title));
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Identity of a Discovered Job across sources: normalized company + title. */
export function jobKeyFor(company: string, title: string): string {
  return sha256(`${normalizeCompany(company)}|${normalizeTitle(title)}`).slice(0, 32);
}

/** Hash of the description as the LLM would read it; whitespace changes do not count. */
export function descriptionHash(description: string): string {
  return sha256(description.replace(/\s+/g, " ").trim());
}
