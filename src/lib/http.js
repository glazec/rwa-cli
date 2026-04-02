const DEFAULT_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "user-agent": "rwa-cli/0.1.0",
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, init, timeoutMs);
  return await response.json();
}

export async function fetchText(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, init, timeoutMs);
  return await response.text();
}

export function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function compactList(values) {
  return [...new Set(values.filter(Boolean))];
}
