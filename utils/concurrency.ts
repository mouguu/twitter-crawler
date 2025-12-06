/**
 * Concurrency utilities
 */

/**
 * Race a promise against a cancellation check.
 * This ensures that long-running operations can be interrupted if a cancellation signal is received.
 *
 * @param promise The main operation promise (e.g. Puppeteer evaluation)
 * @param shouldStop A callback that returns true if the operation should be cancelled
 * @param checkIntervalMs How often to check the shouldStop condition (default 200ms)
 * @returns The result of the promise
 * @throws Error if the operation is cancelled
 */
export async function waitOrCancel<T>(
  promise: Promise<T>,
  shouldStop: () => Promise<boolean> | boolean,
  checkIntervalMs: number = 200,
): Promise<T> {
  let interval: ReturnType<typeof setInterval> | undefined;

  const cancelCheck = new Promise<never>((_, reject) => {
    interval = setInterval(async () => {
      try {
        const stopped = await shouldStop();
        if (stopped) {
          clearInterval(interval);
          reject(new Error('Job cancelled by user'));
        }
      } catch (error) {
        // Ignore errors in shouldStop check
      }
    }, checkIntervalMs);
  });

  try {
    return await Promise.race([promise, cancelCheck]);
  } finally {
    if (interval) clearInterval(interval);
  }
}

/**
 * A throttled wait that can be interrupted.
 */
export async function sleepOrCancel(
  ms: number,
  shouldStop: () => Promise<boolean> | boolean,
  checkIntervalMs: number = 200,
): Promise<void> {
  // Guard against negative initial duration
  if (ms <= 0) return;

  const start = Date.now();
  // Ensure we don't pass negative values if the loop condition was true but time passed
  while (Date.now() - start < ms) {
    if (await shouldStop()) {
      throw new Error('Job cancelled by user');
    }
    const elapsedTime = Date.now() - start;
    const remaining = ms - elapsedTime;
    
    // Check if time expired during the async check
    if (remaining <= 0) break;
    
    // Cap delay at remaining time, but ensure it's at least 0 (sanity check)
    // and wait for at most checkIntervalMs
    const waitTime = Math.max(0, Math.min(remaining, checkIntervalMs));
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
}
