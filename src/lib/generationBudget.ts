/**
 * Time-budget decision for the server-side generation loop.
 *
 * Serverless hosts kill a function at a hard duration cap (Vercel Hobby = 60s).
 * Rather than let the platform abruptly sever the SSE stream, the loop stops
 * itself early — before starting a section it likely can't finish — and emits a
 * graceful "incomplete" terminal event the client resumes from automatically.
 *
 * The first section in a batch always runs (no average yet), which guarantees
 * forward progress as long as a single section fits within the cap.
 */
export interface BudgetInput {
  /** Milliseconds elapsed since this request started. */
  elapsedMs: number;
  /** Average ms per completed section so far (0 if none completed yet). */
  avgSectionMs: number;
  /** The host's hard duration cap, in ms (e.g. 60_000). */
  hardLimitMs: number;
  /** Headroom reserved for the final flush + network, in ms. */
  safetyMs?: number;
}

/**
 * Returns true if we should stop before starting another section because
 * finishing it would risk crossing the hard cap. Conservative: estimates the
 * next section at 1.5× the running average.
 */
export function shouldStopForTime({
  elapsedMs,
  avgSectionMs,
  hardLimitMs,
  safetyMs = 8000,
}: BudgetInput): boolean {
  // No completed section yet → always run at least one (forward progress).
  if (avgSectionMs <= 0) return false;
  const estimatedNext = avgSectionMs * 1.5;
  return elapsedMs + estimatedNext > hardLimitMs - safetyMs;
}
