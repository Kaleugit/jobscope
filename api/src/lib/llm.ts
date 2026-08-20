// Job info extraction via Google Gemini free tier (REST, no SDK needed).
// With a URL, Gemini's url_context tool fetches the posting itself.
// Swapping providers later (e.g. Amazon Bedrock) only requires replacing
// this module — the rest of the pipeline is provider-agnostic.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

export interface JobInfo {
  company: string;
  role: string;
  skills: string[];
}

const RULES = `You are a recruiting analyst. Extract from the job posting:
- "company": the hiring company name
- "role": the job title
- "skills": technical and professional skills required (tools, languages, frameworks, cloud services, methodologies). Normalize names (e.g. "ReactJS" -> "React", "Amazon Web Services" -> "AWS"). Maximum 25, most important first.

Return ONLY a JSON object like {"company": "...", "role": "...", "skills": ["...", "..."]} with no markdown fences and no commentary. If the page is not a job posting or cannot be read, return {"error": "<short reason>"}.`;

function parseJobInfo(text: string): JobInfo {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`LLM returned no JSON: ${cleaned.slice(0, 200)}`);

  const parsed = JSON.parse(match[0]) as {
    company?: unknown;
    role?: unknown;
    skills?: unknown;
    error?: unknown;
  };

  if (typeof parsed.error === "string") {
    throw new Error(`LLM could not extract job info: ${parsed.error}`);
  }

  const company = typeof parsed.company === "string" ? parsed.company.trim() : "";
  const role = typeof parsed.role === "string" ? parsed.role.trim() : "";
  if (!company || !role) {
    throw new Error("LLM response missing company or role");
  }

  const skills = Array.isArray(parsed.skills)
    ? parsed.skills
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim())
        .slice(0, 25)
    : [];

  return { company, role, skills };
}

export async function extractJobInfo(input: {
  url?: string;
  jdText?: string;
}): Promise<JobInfo> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  if (!input.url && !input.jdText) {
    throw new Error("extractJobInfo needs a url or jdText");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const prompt = input.url
    ? `${RULES}\n\nJob posting URL (fetch it): ${input.url}`
    : `${RULES}\n\nJob description:\n${input.jdText!.slice(0, 20_000)}`;

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0 },
  };
  if (input.url) {
    body.tools = [{ url_context: {} }];
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errBody.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("") ?? "";

  return parseJobInfo(text);
}
