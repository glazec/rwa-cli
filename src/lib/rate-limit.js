const DEFAULT_MIN_INTERVAL_MS = 1100;
const providerQueues = new Map();

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runRateLimited(provider, request, minIntervalMs = DEFAULT_MIN_INTERVAL_MS) {
  const key = String(provider || "default");
  const previous = providerQueues.get(key) ?? Promise.resolve();

  const scheduled = previous.then(async () => {
    try {
      const first = await request();
      if (first !== null && first !== undefined) {
        await sleep(minIntervalMs);
        return first;
      }
    } catch {
      // retry path below
    }

    await sleep(minIntervalMs);

    try {
      const retry = await request();
      await sleep(minIntervalMs);
      return retry ?? null;
    } catch {
      await sleep(minIntervalMs);
      return null;
    }
  });

  providerQueues.set(key, scheduled.catch(() => null));
  return await scheduled;
}
