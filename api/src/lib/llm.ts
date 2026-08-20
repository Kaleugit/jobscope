// Skill extraction via Google Gemini free tier (REST, no SDK needed).
// Swapping providers later (e.g. Amazon Bedrock) only requires replacing
// this module — the rest of the pipeline is provider-agnostic.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

const PROMPT = `You are a recruiting analyst. Extract the technical and professional skills required by the following job description.

Rules:
- Return ONLY a JSON object: {"skills": ["skill1", "skill2", ...]}
- Normalize names (e.g. "ReactJS" -> "React", "Amazon Web Services" -> "AWS")
- Include tools, languages, frameworks, cloud services and relevant methodologies
- Maximum 25 skills, most important first

Job description:
`;

export async function extractSkills(jdText: string): Promise<string[]> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT + jdText.slice(0, 20_000) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const parsed = JSON.parse(text) as { skills?: unknown };

  if (!Array.isArray(parsed.skills)) {
    throw new Error("LLM response missing skills array");
  }

  return parsed.skills
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, 25);
}
