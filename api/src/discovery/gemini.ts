// Gemini REST client and the sequential call queue for discovery. The model id
// is configurable because the names change; the key goes in a header, never in
// a URL that could end up in a log.

import { sleep } from "./http";

export interface GeminiConfig {
  apiKey: string;
  model: string;
  /** Spacing between calls, to stay under the free tier's requests per minute. */
  intervalMs: number;
  /** Hard cap per run; what is left stays pending for the next run. */
  maxCalls: number;
  /** "low" keeps a call around 3s; the default thinking took 13-25s per job. */
  thinkingLevel: string;
}

export function geminiConfigFromEnv(): GeminiConfig {
  return {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    // Free-tier quotas are per model and per project. Discovery uses its own
    // model and never falls back to GEMINI_MODEL, so it cannot eat the daily
    // quota the public demo depends on.
    model: process.env.GEMINI_DISCOVERY_MODEL || "gemini-3.5-flash-lite",
    intervalMs: Number(process.env.DISCOVERY_LLM_INTERVAL_MS ?? 10_000),
    // Each call scores a batch of 8 jobs.
    maxCalls: Number(process.env.DISCOVERY_MAX_LLM_CALLS ?? 15),
    thinkingLevel: process.env.DISCOVERY_THINKING_LEVEL || "low",
  };
}

/** The daily quota is gone: stop calling for this run. */
export class QuotaExhausted extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExhausted";
  }
}

/** Reads Google's structured 429: QuotaFailure.violations[].quotaId says per-day
 *  or per-minute ("GenerateRequestsPerDayPerProjectPerModel-FreeTier"), and
 *  RetryInfo.retryDelay says how long to wait. */
export function parseQuotaError(body: string): { daily: boolean; limit?: string; retryMs?: number } {
  try {
    const details = (JSON.parse(body) as { error?: { details?: Record<string, unknown>[] } }).error?.details ?? [];
    let daily = false;
    let limit: string | undefined;
    let retryMs: number | undefined;
    for (const detail of details) {
      const violations = (detail.violations as { quotaId?: string; quotaValue?: string }[] | undefined) ?? [];
      for (const v of violations) {
        if (/PerDay/i.test(v.quotaId ?? "")) {
          daily = true;
          limit = v.quotaValue;
        }
      }
      const delay = typeof detail.retryDelay === "string" ? detail.retryDelay.match(/^(\d+(?:\.\d+)?)s$/) : null;
      if (delay) retryMs = Math.ceil(Number(delay[1]) * 1000) + 500;
    }
    return { daily, limit, retryMs };
  } catch {
    return { daily: false };
  }
}

export type GenerateJson =(prompt: string, schema: object) => Promise<string>;

export function geminiGenerateJson(config: GeminiConfig): GenerateJson {
  return async (prompt, schema) => {
    if (!config.apiKey) throw new Error("GEMINI_API_KEY is not configured");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: schema,
        ...(config.thinkingLevel ? { thinkingConfig: { thinkingLevel: config.thinkingLevel } } : {}),
      },
    });

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
        body,
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      }
      const text = await res.text();
      if (res.status === 429) {
        const quota = parseQuotaError(text);
        // A per-day quota will not come back within this run; a per-minute one will.
        if (quota.daily) throw new QuotaExhausted(`daily quota (${quota.limit ?? "?"}) exhausted for ${config.model}`);
        if (attempt >= 4) throw new QuotaExhausted(`still rate limited after retries for ${config.model}`);
        await sleep(Math.min(quota.retryMs ?? 10_000 * 2 ** attempt, 65_000));
        continue;
      }
      if (res.status >= 500 && attempt < 2) {
        await sleep(5_000 * 2 ** attempt);
        continue;
      }
      throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 300)}`);
    }
  };
}

export interface QueueResult<T> {
  done: T[];
  /** Items not attempted because the cap or the quota stopped the queue. */
  leftover: number;
  calls: number;
  stoppedBy?: "cap" | "quota";
}

/** Runs one call per item, in order, spaced by intervalMs, stopping at the cap or the quota. */
export async function runQueue<I, T>(
  items: I[],
  config: Pick<GeminiConfig, "intervalMs" | "maxCalls">,
  work: (item: I) => Promise<T>,
  deadline?: number
): Promise<QueueResult<T>> {
  const done: T[] = [];
  let calls = 0;
  for (let i = 0; i < items.length; i++) {
    if (calls >= config.maxCalls) return { done, leftover: items.length - i, calls, stoppedBy: "cap" };
    if (deadline && Date.now() > deadline) return { done, leftover: items.length - i, calls, stoppedBy: "cap" };
    if (calls > 0) await sleep(config.intervalMs);
    calls++;
    try {
      done.push(await work(items[i]));
    } catch (error) {
      if (error instanceof QuotaExhausted) {
        return { done, leftover: items.length - i, calls, stoppedBy: "quota" };
      }
      throw error;
    }
  }
  return { done, leftover: 0, calls };
}
