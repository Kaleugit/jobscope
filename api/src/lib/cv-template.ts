// FROZEN TEMPLATE — the visual identity of every deliverable.
// Ported verbatim from latam-cv-maker/base (template.css + skeleton.html).
// Do not vary per job: the variation surface is content, wording and section
// order. Style is outside it.
//
// ATS constraints this stylesheet materializes (docs/ats-guidelines.md):
//   single column · no table/grid/box · no header/footer · no image/icon
//   web-safe font (Georgia) · 10.5pt body · standard bullets · margins >= 0.5in

export const TEMPLATE_CSS = `@page {
  size: A4;
  margin: 18mm 20mm;
}

* {
  box-sizing: border-box;
}

body {
  font-family: Georgia, "Times New Roman", serif;
  color: #1a1a1a;
  font-size: 10.5pt;
  line-height: 1.45;
  margin: 0;
}

h1 {
  font-size: 20pt;
  margin: 0 0 2pt;
  letter-spacing: .5px;
}

.headline {
  margin: 0 0 4pt;
  font-size: 11.5pt;
  color: #1a4d8f;
  font-weight: bold;
}

.contact {
  font-size: 9.5pt;
  color: #333;
  margin-bottom: 14pt;
}

.contact a {
  color: #1a4d8f;
  text-decoration: none;
}

.contact span + span::before {
  content: " \\00b7 ";
  color: #999;
}

h2 {
  font-size: 12pt;
  text-transform: uppercase;
  letter-spacing: 1px;
  border-bottom: 1px solid #1a1a1a;
  padding-bottom: 2pt;
  margin: 12pt 0 6pt;
  page-break-after: avoid;
}

.job,
.project {
  margin-bottom: 8pt;
  page-break-inside: avoid;
}

.job-header,
.project-header {
  display: flex;
  justify-content: space-between;
}

.job-title,
.project-title {
  font-weight: bold;
}

.job-dates,
.project-meta {
  font-style: italic;
  color: #444;
  white-space: nowrap;
  padding-left: 10pt;
}

ul {
  margin: 3pt 0 0;
  padding-left: 16pt;
}

li {
  margin-bottom: 2pt;
}

.skills p {
  margin: 2pt 0;
}

/* --- Cover letter ------------------------------------------------------- */

.letter-date {
  margin: 6pt 0 12pt;
  font-size: 10pt;
  color: #444;
}

.letter p {
  margin: 0 0 8pt;
  text-align: justify;
}

.letter-greeting {
  margin: 0 0 10pt;
}

.letter-signature {
  margin-top: 14pt;
}`;

/**
 * Reading comfort on screen only. Print keeps the ATS layout untouched: the
 * paper gets white with black text, the screen gets a warm page with room to
 * breathe, the way an e-reader shows a document.
 */
// The [data-measure] guard keeps these rules off the hidden iframe that
// measures how much of the printed page the content fills.
const SCREEN_CSS = `@media screen {
  html:not([data-measure]) {
    background: #d9d2c5;
  }
  html:not([data-measure]) body {
    background: #f7f2e7;
    color: #2a2724;
    font-size: 12pt;
    line-height: 1.62;
    max-width: 46rem;
    margin: 0 auto;
    padding: 3.2rem 3rem 3.6rem;
    min-height: 100vh;
    box-shadow: 0 0 24px rgb(0 0 0 / 0.12);
  }
  html:not([data-measure]) h1 {
    font-size: 22pt;
  }
  html:not([data-measure]) h2 {
    font-size: 12.5pt;
    border-bottom-color: #b9b0a0;
    margin-top: 20pt;
  }
  html:not([data-measure]) .contact,
  html:not([data-measure]) .job-dates,
  html:not([data-measure]) .project-meta {
    color: #5b554d;
  }
  html:not([data-measure]) li {
    margin-bottom: 4pt;
  }
  html:not([data-measure]) .letter p {
    line-height: 1.72;
  }
}

@media screen and (max-width: 640px) {
  html:not([data-measure]) body {
    padding: 2rem 1.4rem;
    font-size: 11.5pt;
  }
}`;

/** Wraps a body fragment in the frozen skeleton. */
export function compose(input: {
  lang: string;
  title: string;
  body: string;
}): string {
  return `<!DOCTYPE html>
<html lang="${input.lang}">
<head>
<meta charset="UTF-8">
<title>${input.title}</title>
<style>
${TEMPLATE_CSS}

${SCREEN_CSS}
</style>
</head>
<body>
${input.body}
</body>
</html>`;
}

/**
 * Em dash in prose is a blocking gate: it is the most recognizable mark of
 * generated text. Headings and job/project title lines are exempt, and the
 * en dash used in date ranges is range typography, not sentence punctuation.
 */
export function findEmDashInProse(html: string): boolean {
  const withoutHeadings = html
    .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, "")
    .replace(
      /<span class="(?:job-title|project-title|job-dates|project-meta)"[^>]*>[\s\S]*?<\/span>/gi,
      ""
    );

  const prose = [...withoutHeadings.matchAll(/<(p|li)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => m[2])
    .join("\n");

  return prose.includes("—");
}

/** Non-blocking voice warnings, mirroring build.mjs. */
export function voiceWarnings(text: string): string[] {
  const warnings: string[] = [];
  const plain = text.replace(/<[^>]+>/g, " ");

  const semicolons = (plain.match(/;/g) ?? []).length;
  if (semicolons > 0) {
    warnings.push(`${semicolons} semicolon(s): he uses a full stop`);
  }

  const sentences = plain
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length > 0) {
    const words = sentences.map((s) => s.split(/\s+/).length);
    const average = words.reduce((a, b) => a + b, 0) / words.length;
    const longest = Math.max(...words);
    if (average > 20) {
      warnings.push(`${average.toFixed(1)} words per sentence: his voice sits below 20`);
    }
    if (longest > 35) {
      warnings.push(`longest sentence has ${longest} words`);
    }
  }

  return warnings;
}

/**
 * Cheap page-occupancy estimate using the calibration documented in the
 * gerar-cv skill (170mm print width, Georgia 10.5pt): ~95 characters per line,
 * ~15px per text line, ~30px per h2, A4 usable height 986px. The browser
 * measures the real height later; this only steers the generation loop.
 */
export const PAGE_USABLE_PX = 986;

export function estimateHeightPx(bodyHtml: string): number {
  let height = 0;

  const blocks = [...bodyHtml.matchAll(/<(h1|h2|p|li)[^>]*>([\s\S]*?)<\/\1>/gi)];
  for (const [, tag, inner] of blocks) {
    const text = inner.replace(/<[^>]+>/g, "").trim();
    const lines = Math.max(1, Math.ceil(text.length / 95));
    if (tag.toLowerCase() === "h2") height += 30;
    else if (tag.toLowerCase() === "h1") height += 34;
    else height += lines * 15;
  }

  // Section and job blocks carry their own margins.
  height += (bodyHtml.match(/class="(?:job|project)"/g) ?? []).length * 8;
  return height;
}
