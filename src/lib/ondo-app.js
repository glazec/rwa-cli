import { getOrSetCachedJsonStaleOnError } from "./cache.js";
import { fetchJson } from "./http.js";

export const ONDO_APP_ASSETS_URL = "https://app.ondo.finance/api/v2/assets";
const ONDO_APP_INFO_BASE_URL = "https://app.ondo.finance/api/v2/assets";

export async function fetchOndoAssets() {
  const cacheKey = "ondo-app-assets";

  return await getOrSetCachedJsonStaleOnError(cacheKey, async () => {
    const json = await fetchJson(ONDO_APP_ASSETS_URL, {}, 15000);
    return json?.assets ?? [];
  });
}

export async function fetchOndoAssetInfo(symbolOrSlug) {
  const slug = String(symbolOrSlug || "").trim().toLowerCase();
  if (!slug) {
    return null;
  }

  const cacheKey = `ondo-app-info-${slug}`;
  return await getOrSetCachedJsonStaleOnError(cacheKey, async () => {
    return await fetchJson(`${ONDO_APP_INFO_BASE_URL}/${slug}/info`, {}, 15000);
  });
}
