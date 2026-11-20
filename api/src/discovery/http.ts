// HTTP for source modules: identifiable User-Agent, timeout, and retry with
// backoff on 429 and 5xx (honoring Retry-After). Nothing here knows about jobs.

export const USER_AGENT = "jobscope-discovery/1.0 (personal job search; github.com/Kaleugit/jobscope)";

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** Base backoff; doubles each attempt. */
  backoffMs?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const { headers = {}, timeoutMs = 20_000, retries = 3, backoffMs = 2_000 } = options;

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "*/*", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt >= retries) throw error;
      await sleep(backoffMs * 2 ** attempt);
      continue;
    }

    if (response.ok) return response.text();

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= retries) throw new HttpError(response.status, url);

    const wait = retryAfterMs(response.headers.get("retry-after")) ?? backoffMs * 2 ** attempt;
    // Never wait longer than a minute inside a Lambda run.
    await sleep(Math.min(wait, 60_000));
  }
}

export async function fetchJson<T>(url: string, options?: FetchOptions): Promise<T> {
  return JSON.parse(await fetchText(url, options)) as T;
}
