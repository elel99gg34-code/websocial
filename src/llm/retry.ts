import { log } from "../core/log.ts";

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryAfterMs: number;
  constructor(status: number, body: string, retryAfterMs = 0) {
    super(`HTTP ${status}: ${body.slice(0, 400)}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

function statusOf(err: unknown): number {
  if (err instanceof HttpError) return err.status;
  if (typeof err === "object" && err !== null && "status" in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === "number") return s;
  }
  return 0;
}

export function isRetryable(err: unknown): boolean {
  const status = statusOf(err);
  if (status !== 0) return RETRYABLE_STATUS.has(status);
  // fetch 네트워크 오류는 TypeError 로 온다
  return err instanceof TypeError || (err instanceof Error && err.name === "AbortError");
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type RetryOptions = {
  label: string;
  attempts?: number;
  baseDelayMs?: number;
};

/** 429/5xx/네트워크 오류에 대해 지수 백오프 재시도 (2s, 4s, 8s, 16s) */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const base = opts.baseDelayMs ?? 2000;
  let lastError: unknown;

  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || i === attempts - 1) throw err;
      const hinted = err instanceof HttpError ? err.retryAfterMs : 0;
      const delay = hinted > 0 ? hinted : base * 2 ** i;
      log.warn(
        `${opts.label} 실패(${i + 1}/${attempts}) → ${Math.round(delay / 1000)}초 후 재시도: ${
          err instanceof Error ? err.message.slice(0, 160) : String(err)
        }`,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

export function retryAfterMs(headers: Headers): number {
  const raw = headers.get("retry-after");
  if (raw === null) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 60_000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? 0 : Math.min(Math.max(date - Date.now(), 0), 60_000);
}
