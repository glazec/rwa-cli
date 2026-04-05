import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CACHE_TTL_HOURS = 24;
const DEFAULT_SLIPPAGE_CACHE_TTL_HOURS = 1;
let cacheBypass = false;

function sanitizeCacheKey(key) {
  return String(key || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cacheDir() {
  return process.env.RWA_CACHE_DIR || path.join(process.cwd(), ".cache", "rwa");
}

function cacheFilePath(key) {
  const file = `${sanitizeCacheKey(key) || "cache"}.json`;
  return path.join(cacheDir(), file);
}

async function readCacheFile(file) {
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw);
}

export function hoursToMs(hours, fallbackHours = DEFAULT_CACHE_TTL_HOURS) {
  const parsed = Number(hours);
  const safeHours = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackHours;
  return safeHours * 60 * 60 * 1000;
}

function defaultTtlMs() {
  return hoursToMs(process.env.RWA_CACHE_TTL_HOURS ?? DEFAULT_CACHE_TTL_HOURS, DEFAULT_CACHE_TTL_HOURS);
}

export function slippageCacheTtlMs() {
  return hoursToMs(
    process.env.RWA_SLIPPAGE_CACHE_TTL_HOURS ?? DEFAULT_SLIPPAGE_CACHE_TTL_HOURS,
    DEFAULT_SLIPPAGE_CACHE_TTL_HOURS
  );
}

export async function readCachedJson(key, ttlMs = defaultTtlMs()) {
  const file = cacheFilePath(key);

  try {
    const fileStat = await stat(file);
    if (Date.now() - fileStat.mtimeMs > ttlMs) {
      return null;
    }

    return await readCacheFile(file);
  } catch {
    return null;
  }
}

export async function readCachedJsonStale(key) {
  const file = cacheFilePath(key);

  try {
    return await readCacheFile(file);
  } catch {
    return null;
  }
}

export async function writeCachedJson(key, value) {
  const file = cacheFilePath(key);

  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2), "utf8");
  } catch {
    return value;
  }

  return value;
}

export async function getOrSetCachedJson(key, fetcher, ttlMs = defaultTtlMs()) {
  if (!cacheBypass) {
    const cached = await readCachedJson(key, ttlMs);
    if (cached !== null) {
      return cached;
    }
  }

  const fresh = await fetcher();
  await writeCachedJson(key, fresh);
  return fresh;
}

export async function getOrSetCachedJsonStaleOnError(key, fetcher, ttlMs = defaultTtlMs()) {
  if (!cacheBypass) {
    const cached = await readCachedJson(key, ttlMs);
    if (cached !== null) {
      return cached;
    }
  }

  try {
    const fresh = await fetcher();
    await writeCachedJson(key, fresh);
    return fresh;
  } catch (error) {
    const stale = await readCachedJsonStale(key);
    if (stale !== null) {
      return stale;
    }
    throw error;
  }
}

export function setCacheBypass(value) {
  cacheBypass = Boolean(value);
}

export async function clearCache() {
  const dir = cacheDir();

  try {
    const files = await readdir(dir);
    await Promise.all(files.map((file) => rm(path.join(dir, file), { force: true })));
    return {
      dir,
      removed: files.length
    };
  } catch {
    return {
      dir,
      removed: 0
    };
  }
}

export function cacheSettings() {
  return {
    dir: cacheDir(),
    ttlHours: defaultTtlMs() / (60 * 60 * 1000),
    slippageTtlHours: slippageCacheTtlMs() / (60 * 60 * 1000),
    bypass: cacheBypass
  };
}
