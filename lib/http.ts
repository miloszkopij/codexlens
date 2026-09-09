export async function fetchJson<T>(url: string, options: RequestInit = {}, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try { body = JSON.parse(text); }
        catch { throw new Error(`Unexpected non-JSON response (${response.status})`); }
      }
      if (response.ok) return body as T;
      const payload = body as { error?: string | { message?: string }; detail?: string } | null;
      const detail = typeof payload?.error === "string" ? payload.error : payload?.error?.message ?? payload?.detail ?? response.statusText;
      const error = new Error(`HTTP ${response.status}: ${detail}`) as Error & { status?: number; retryAfter?: number };
      error.status = response.status;
      const retryAfter = Number(response.headers.get("retry-after"));
      error.retryAfter = Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined;
      if (![429, 500, 502, 503, 504].includes(response.status)) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number }).status;
      if (status && ![429, 500, 502, 503, 504].includes(status)) throw error;
    }
    if (attempt < attempts) {
      const retryAfter = (lastError as { retryAfter?: number })?.retryAfter ?? 0;
      await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter, Math.min(8_000, 500 * 2 ** (attempt - 1)))));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex; nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
