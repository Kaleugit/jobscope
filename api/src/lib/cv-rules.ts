// The rules that govern every generated deliverable.
//
// Ported from two local tools: latam-cv-maker (structure, ATS guidelines,
// invariants, gates) and fin-cv-maker (WIS job-analysis framework, the
// jurisdiction disclosures, the named-recipient letter layout).
//
// The frozen template lives in cv-template.ts. Content, wording and section
// order are the variation surface; style is not.

export const INVARIANTS = `INVARIANTS. Breaking any of these invalidates the result.

1. NOTHING IS INVENTED. Every claim in both deliverables comes from the master profile below. If the posting asks for something that is not there, it stays out, and you report the gap instead of inventing coverage.
2. RESPECT THE LIMITS. If the master profile has a section listing what must not be claimed (limits, confirmed gaps, honesty notes), it overrides everything else. It exists so the resume survives the technical interview.
3. NEVER USE AN EM DASH IN PROSE. Not in bullets, not in paragraphs, not in the plain text letter. It is allowed only in headings and job title lines (Role | Company — City). The em dash is the most recognizable fingerprint of generated text, and a document that reads as generated loses before it is read. Use a comma, a colon, parentheses, or end the sentence. This is absolute and it is checked automatically.
4. YOU WRITE CONTENT FRAGMENTS ONLY. No <!DOCTYPE>, <html>, <head>, <style> or <body> tags, and no CSS. The application wraps your fragments in a frozen skeleton.
5. ONE PAGE EACH. The resume and the letter each fit on a single A4 page. This is measured, not estimated.
6. NO EMOJI, EVER.
7. INTERNAL IDS NEVER REACH THE PAGE. The master profile uses anchors like EXP-ACME, PROJ-CLI, ANC-REPORTS, RES-DEV to make content traceable. They are addresses, not names. Print the real name of the company, the project or the story, never the identifier.`;

export const VOICE = `VOICE. Write the way the candidate writes. A letter that sounds generated loses before it is read, and the em dash is only the most visible symptom.

Positive pattern:
- Short declarative sentences. Subject, verb, fact. Joined by "and", not by stacked subordination.
- Name concrete things. "Claude API", "service order", "BullMQ", "tractor transmission case", "Power BI". A specific noun instead of a category.
- Say what happened, not what it means. Do not interpret your own work.
- Sequence, not arc. Plain chronological order.
- Scope down. "I only connected the endpoints and built the UI" instead of "I developed the platform". This is what makes the text sound honest.
- State the problem directly when there is one, with no elaborate justification.

Never do:
| Fingerprint | Instead |
|---|---|
| Abstract opening thesis ("Client work has a particular shape:") | Say who he is and what he is applying to |
| Punchline at the end of a paragraph | End on the fact ("It went live and hundreds of people played it") |
| Rule of three | One statement |
| Colon followed by a reveal | Full stop, new sentence |
| Meta-commentary ("that fixed date shapes every decision") | Cut the sentence |
| Semicolon | Full stop |
| Em dash | Comma, colon or full stop |
| "Two things brought me here", "The result that matters", "stated plainly" | Say the thing |
| Stated enthusiasm ("I am eager to", "I am passionate about", "excited by the opportunity") | Say what he would do, or cut it |
| Passive investigation voice ("the analysis revealed that") | "I found that" |

These are judgement, not gates. Reread every draft and ask: would he write this sentence?`;

export const ATS_GUIDELINES = `ATS GUIDELINES (stable layer, valid for any posting).

LAYOUT. Single column, always: multi-column scrambles the parser's reading order. No tables, grids or text boxes. No header/footer, contact goes in the body. No images, icons, charts or proficiency bars. One page for profiles under ten years of career.

SECTIONS. Use conventional names, the parser maps by known label: Summary, Skills, Work Experience, Projects, Education, Certifications (or their equivalents in the output language). Avoid creative headings like "About me", "My toolbox", "Journey", "Portfolio". Order that works: contact, summary, skills, experience, projects, education, certifications. Skills and experience can swap depending on what the posting values.

DATES. Consistent format across the whole document, always month plus year ("January 2022 – Present"). No open ranges without "Present".

KEYWORDS. This is the central point. 2026 ATS scores presence, context and recency, not raw count.
- Pull three groups from the posting: hard requirements, tools and stack, nice to have.
- Put each term in up to three places: the skills block, the title line of the relevant job, and the bullet that proves it. A term that appears only in the skills list weighs less than a term with evidence behind it.
- Mirror the advertiser's wording when it is true. If the posting says "REST APIs" and you wrote "web services", an exact match search does not find him.
- One to three occurrences per term. Repeating a term ten times triggers a spam filter.
- Never include a term he cannot defend in an interview. Keyword stuffing passes the ATS and dies in the first technical conversation.
- Write the acronym and the spelled out term on first use when both are searchable ("CI/CD (continuous integration)").

BULLETS. Start with an action verb, past tense (present for the current role). Quantify. Structure: what you did, how, measurable result. Be precise about scope.

CONTACT. Name, city and country, phone, email in the body right under the name. URLs as readable text (linkedin.com/in/user), never hidden behind "click here".`;

export const JOB_ANALYSIS = `JOB ANALYSIS (from the Work Integration Steps framework).

Before selecting any content, read the posting for:
- The recruitment need: why are they hiring for this now?
- The concrete tasks the role performs day to day.
- Skills required versus skills merely valued. Same for education and experience.
- The exact keywords the advertiser uses, to mirror them.
- The work environment and what it implies about the team.

Employers weigh three pillars, and a strong application addresses all three:
1. Get the job done. Where the skills come from and what value they add.
2. Happy worker. Why this company and this role specifically, not any job.
3. Good co-worker. Attitude, working style, and language.

For each task in the posting, work out four things: what is the task, why can he do it, why can he do it well HERE, and why does he want to. What does not fit in the letter is interview preparation, not filler.`;

export const RESUME_SPEC = `RESUME. Select what competes for THIS posting.

- Pick the headline and the summary angle that match the target.
- Order sections by what the posting values. A data role puts Skills before Experience. A development role puts Experience before Skills.
- Choose bullets by relevance, not by completeness. A bullet that does not speak to the posting takes the space of one that does.
- Cut irrelevant experience entirely when needed.
- Pick two or three projects for "Selected Projects". It is the section that adapts most between postings.
- Group skills into the categories the posting uses, with the terms the posting uses.
- Include a conditional section (for example a non-software background) only when the role actually involves that kind of work.

Allowed classes, defined in the frozen stylesheet you must not write: headline, contact, job, job-header, job-title, job-dates, project, project-header, project-title, project-meta, skills.

Shape of the fragment:

<h1>Full Name</h1>
<p class="headline">Role | Stack · Stack · Stack</p>
<div class="contact">
  <span>City, Country</span>
  <span>phone</span>
  <span><a href="mailto:...">email</a></span><br>
  <span><a href="https://linkedin.com/in/...">linkedin.com/in/...</a></span>
  <span><a href="https://github.com/...">github.com/...</a></span>
</div>

<h2>Summary</h2>
<p>...</p>

<h2>Skills</h2>
<div class="skills"><p><b>Front-End:</b> ...</p></div>

<h2>Work Experience</h2>
<div class="job">
  <div class="job-header">
    <span class="job-title">Role | Company — City</span>
    <span class="job-dates">Jan 2025 – Present</span>
  </div>
  <ul><li>...</li></ul>
</div>

<h2>Selected Projects</h2>
<ul><li><b>name</b> (stack): one line.</li></ul>

<h2>Education</h2>
<h2>Languages</h2>
<h2>Certifications</h2>`;

export const LETTER_SPEC = `COVER LETTER. Four short paragraphs, 200 to 250 words, complementing the resume instead of repeating it.

- P1: who he is and which role he is applying to. Two lines. No thesis, no hook.
- P2: what he does today, in facts.
- P3: one anchor story from the master profile, the one closest to the problem in the posting, told as a sequence of events. The number or result comes at the end, as a consequence.
- P4: what has to be said directly, then the closing. This is where disclosures live: a requirement he does not meet (name the gap, do not hide it), work authorization or visa status framed as a manageable administrative step, language level stated honestly, location and availability, and salary only if the posting asked for it.

Address a named recipient when the posting names one (hiring manager, team lead). Fall back to the team otherwise.

Allowed classes: headline, contact, letter, letter-date, letter-greeting, letter-signature.

Shape of the fragment:

<h1>Full Name</h1>
<p class="headline">...</p>
<div class="contact">...</div>
<p class="letter-date">City, 20 August 2026</p>
<div class="letter">
  <p class="letter-greeting">Dear {name or team},</p>
  <p>P1</p><p>P2</p><p>P3</p><p>P4</p>
  <p class="letter-signature">Sincerely,<br>Full Name</p>
</div>

Also produce the same letter as plain text, no tags, ready to paste into a form or an email body, with the contact header as simple lines.`;

export const OUTPUT_CONTRACT = `OUTPUT. Return ONLY a JSON object with these keys, no markdown fences and no commentary:

{
  "lang": "the BCP47 tag of the output language, mirroring the posting language (e.g. \\"en\\" or \\"pt-BR\\")",
  "recipient": "the named recipient if the posting has one, otherwise an empty string",
  "resumeBodyHtml": "the resume body fragment",
  "coverLetterBodyHtml": "the cover letter body fragment",
  "coverLetterText": "the letter as plain text",
  "angle": "one sentence on the angle chosen and the section order, for the report",
  "cut": ["what you left out and why"],
  "keywordsCovered": ["posting requirements the documents cover"],
  "gapsHeLacks": ["requirements missing because he does not have them"],
  "gapsNoRoom": ["requirements he has but that did not fit"]
}`;

const MARKET_LATAM = `MARKET: Latin America and remote international.

- Availability and engagement model belong in P4 when the posting is remote or international: contractor terms, invoicing currency, and the hours of overlap with the team's timezone. Take them from the master profile, never invent them.
- No visa or work permit paragraph unless the posting is for another country and the master profile says something about it.
- Keep the deliverables in the language of the posting. Portuguese postings get Portuguese deliverables.`;

const MARKET_FIN = `MARKET: Finland.

Finnish employers weigh stability and transparency, so what looks like a weakness elsewhere is an asset here. Every application addresses three pillars: can he do the job, why does he want THIS company and role, and what is he like as a co-worker (language belongs to this one).

P4 of the cover letter carries three disclosures, compressed and stated plainly, all taken from the master profile:
1. Work authorization: current status and the concrete next step, framed as a manageable administrative step rather than an obstacle.
2. Finnish level, stated honestly, with the commitment to learn. Never skip this.
3. Where he already lives and his availability. Being in the country already is a concrete advantage and should be said.

Also for this market:
- Name the gap. When the posting asks for something he does not have, say so directly in P4 instead of hiding it. Honesty is a competitive advantage here.
- A non-software background section (construction, field or installation work) is included only when the role actually involves that kind of work, and it never inflates the role he played.
- Strictly one to two pages is the local norm, and this tool holds the tighter line at one.`;

export function buildGenerationPrompt(input: {
  masterProfile: string;
  market: "latam" | "fin";
  jobUrl?: string;
  company: string;
  role: string;
  requiredSkills: string[];
  today: string;
  langOverride?: string;
}): string {
  return [
    "You write a resume and a cover letter targeted at one specific job posting.",
    INVARIANTS,
    JOB_ANALYSIS,
    ATS_GUIDELINES,
    VOICE,
    RESUME_SPEC,
    LETTER_SPEC,
    input.market === "fin" ? MARKET_FIN : MARKET_LATAM,
    OUTPUT_CONTRACT,
    `TODAY: ${input.today}`,
    input.langOverride
      ? `OUTPUT LANGUAGE: ${input.langOverride} (explicit override).`
      : "OUTPUT LANGUAGE: mirror the language of the posting. If the master profile carries both a Portuguese and an English wording for an item, select the right one, never translate on the fly.",
    `TARGET: ${input.role} at ${input.company}.`,
    input.jobUrl
      ? `POSTING URL (read it for the full requirements, the recruiter name and the tone): ${input.jobUrl}`
      : "",
    `SKILLS ALREADY EXTRACTED FROM THE POSTING: ${input.requiredSkills.join(", ")}`,
    "MASTER PROFILE, the single source of truth. Nothing outside it may appear in the deliverables:",
    input.masterProfile,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}
