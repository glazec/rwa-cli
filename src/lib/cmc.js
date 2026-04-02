import { fetchJson } from "./http.js";

const CMC_SEARCH_URL = "https://s3.coinmarketcap.com/generated/core/rwa/search.json";

function inflatePackedRecords(payload) {
  if (!payload?.fields || !payload?.values) {
    return [];
  }

  return payload.values.map((row) =>
    Object.fromEntries(payload.fields.map((field, index) => [field, row[index]]))
  );
}

let cmcSearchCache = null;

export async function fetchCmcRwaSearchIndex() {
  if (cmcSearchCache) {
    return cmcSearchCache;
  }

  const json = await fetchJson(CMC_SEARCH_URL, {
    headers: {
      referer: "https://coinmarketcap.com/real-world-assets/"
    }
  });

  cmcSearchCache = inflatePackedRecords(json);
  return cmcSearchCache;
}

export async function fetchCmcRwaAssetTokens(slug, limit = 20) {
  const url = `https://api.coinmarketcap.com/data-api/v3/rwa/asset/list?slug=${encodeURIComponent(
    slug
  )}&page=1&pageSize=${limit}&start=1&limit=${limit}`;

  const json = await fetchJson(url, {
    headers: {
      referer: `https://coinmarketcap.com/real-world-assets/${slug}/`
    }
  });

  return json?.data?.assetInfoList ?? [];
}

export async function fetchCmcRwaMarketPairs(slug, limit = 50, category = "spot") {
  const url =
    "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/market-pairs/latest" +
    `?rwaSlug=${encodeURIComponent(slug)}` +
    `&start=1&limit=${limit}` +
    `&category=${encodeURIComponent(category)}` +
    "&centerType=all&sort=cmc_rank_advanced&direction=desc&spotUntracked=true";

  const json = await fetchJson(url, {
    headers: {
      referer: `https://coinmarketcap.com/real-world-assets/${slug}/`
    }
  });

  return json?.data?.marketPairs ?? [];
}

export async function fetchCmcRwaExchangeSummary(slug) {
  const url = `https://api.coinmarketcap.com/data-api/v3/rwa/web/exchange-pair-info?slug=${encodeURIComponent(slug)}`;
  const json = await fetchJson(url, {
    headers: {
      referer: `https://coinmarketcap.com/real-world-assets/${slug}/`
    }
  });

  return json?.data?.exchanges ?? [];
}

export function findCmcRwaMatches(records, query, limit = 10) {
  const normalized = String(query || "").trim().toLowerCase();
  const exact = records.filter((record) => {
    return (
      String(record.symbol || "").toLowerCase() === normalized ||
      String(record.slug || "").toLowerCase() === normalized ||
      String(record.name || "").toLowerCase() === normalized
    );
  });

  const matches = exact.length
    ? exact
    : records.filter((record) => {
        return (
          String(record.symbol || "").toLowerCase().includes(normalized) ||
          String(record.slug || "").toLowerCase().includes(normalized) ||
          String(record.name || "").toLowerCase().includes(normalized)
        );
      });

  return matches
    .sort((left, right) => Number(left.rank ?? 999999) - Number(right.rank ?? 999999))
    .slice(0, limit);
}

export function isExactCmcMatch(record, query) {
  const normalized = String(query || "").trim().toLowerCase();
  return (
    String(record?.symbol || "").toLowerCase() === normalized ||
    String(record?.slug || "").toLowerCase() === normalized ||
    String(record?.name || "").toLowerCase() === normalized
  );
}
