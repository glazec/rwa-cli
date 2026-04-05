import { fetchJson } from "./http.js";
import { getOrSetCachedJson } from "./cache.js";
import { getSetting } from "./config.js";

const CMC_SEARCH_URL = "https://s3.coinmarketcap.com/generated/core/rwa/search.json";
const UNIBLOCK_CMC_BASE_URL = "https://api.uniblock.dev/direct/v1/CoinMarketCap";

export const CMC_DISCOVERY_CATEGORIES = [
  {
    id: "604f2767ebccdd50cd175fd0",
    name: "Tokenized Stock",
    slug: "tokenized-stock"
  },
  {
    id: "68639a4f358e0763b448bf0c",
    name: "Tokenized commodities",
    slug: "tokenized-commodities"
  },
  {
    id: "68639ad6358e0763b448bf96",
    name: "Tokenized Silver",
    slug: "tokenized-silver"
  },
  {
    id: "68639a79358e0763b448bf51",
    name: "Tokenized ETFs",
    slug: "tokenized-etfs"
  },
  {
    id: "68638d58358e0763b448b3ca",
    name: "Tokenized Assets",
    slug: "tokenized-assets"
  },
  {
    id: "68639ac1358e0763b448bf90",
    name: "Tokenized Real Estate",
    slug: "tokenized-real-estate"
  },
  {
    id: "68639aa7358e0763b448bf8a",
    name: "Tokenized Treasury Bills (T-Bills)",
    slug: "tokenized-t-bills"
  },
  {
    id: "68639b08358e0763b448c036",
    name: "Tokenized Treasury Bonds (T-Bonds)",
    slug: "tokenized-t-bonds"
  }
];

function inflatePackedRecords(payload) {
  if (!payload?.fields || !payload?.values) {
    return [];
  }

  return payload.values.map((row) =>
    Object.fromEntries(payload.fields.map((field, index) => [field, row[index]]))
  );
}

let cmcSearchCache = null;
const cmcCategoryCache = new Map();

function getUniblockApiKey() {
  return getSetting("UNIBLOCK_API_KEY");
}

async function fetchUniblockCmc(path) {
  const apiKey = getUniblockApiKey();
  if (!apiKey) {
    return null;
  }

  try {
    return await fetchJson(
      `${UNIBLOCK_CMC_BASE_URL}${path}`,
      {
        headers: {
          "x-api-key": apiKey
        }
      },
      15000
    );
  } catch {
    return null;
  }
}

export async function fetchCmcRwaSearchIndex() {
  if (cmcSearchCache) {
    return cmcSearchCache;
  }

  cmcSearchCache = await getOrSetCachedJson("cmc-rwa-search-index-v1", async () => {
    const json = await fetchJson(CMC_SEARCH_URL, {
      headers: {
        referer: "https://coinmarketcap.com/real-world-assets/"
      }
    });

    return inflatePackedRecords(json);
  });

  return cmcSearchCache;
}

export async function fetchCmcRwaAssetTokens(slug, limit = 20) {
  return getOrSetCachedJson(`cmc-rwa-asset-list-${slug}-${limit}-v1`, async () => {
    const url = `https://api.coinmarketcap.com/data-api/v3/rwa/asset/list?slug=${encodeURIComponent(
      slug
    )}&page=1&pageSize=${limit}&start=1&limit=${limit}`;

    const json = await fetchJson(url, {
      headers: {
        referer: `https://coinmarketcap.com/real-world-assets/${slug}/`
      }
    });

    return json?.data?.assetInfoList ?? [];
  });
}

export async function fetchCmcRwaMarketPairs(slug, limit = 50, category = "spot") {
  return getOrSetCachedJson(`cmc-rwa-market-pairs-${slug}-${category}-${limit}-v1`, async () => {
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
  });
}

export async function fetchCmcRwaExchangeSummary(slug) {
  return getOrSetCachedJson(`cmc-rwa-exchange-summary-${slug}-v1`, async () => {
    const url = `https://api.coinmarketcap.com/data-api/v3/rwa/web/exchange-pair-info?slug=${encodeURIComponent(slug)}`;
    const json = await fetchJson(url, {
      headers: {
        referer: `https://coinmarketcap.com/real-world-assets/${slug}/`
      }
    });

    return json?.data?.exchanges ?? [];
  });
}

export async function fetchUniblockCmcCategory(id) {
  if (!id) {
    return null;
  }

  if (cmcCategoryCache.has(id)) {
    return cmcCategoryCache.get(id);
  }

  const json = await getOrSetCachedJson(`uniblock-cmc-category-${id}-v1`, async () => {
    return await fetchUniblockCmc(`/v1/cryptocurrency/category?id=${encodeURIComponent(id)}`);
  });
  const category = json?.data ?? null;
  cmcCategoryCache.set(id, category);
  return category;
}

export async function fetchUniblockCmcDiscoveryCategories() {
  const categories = await Promise.all(
    CMC_DISCOVERY_CATEGORIES.map(async (category) => {
      const payload = await fetchUniblockCmcCategory(category.id);
      return payload
        ? {
            ...category,
            payload
          }
        : null;
    })
  );

  return categories.filter(Boolean);
}

export function normalizeCmcCategoryCoin(coin, category) {
  return {
    id: coin.id,
    symbol: coin.symbol,
    name: coin.name,
    slug: coin.slug,
    categoryId: category.id,
    categoryName: category.name,
    categorySlug: category.slug,
    price: coin?.quote?.USD?.price ?? null,
    volume24h: coin?.quote?.USD?.volume_24h ?? null,
    marketCap: coin?.quote?.USD?.market_cap ?? null,
    numMarketPairs: coin?.num_market_pairs ?? null,
    platform: coin?.platform
      ? {
          name: coin.platform.name,
          slug: coin.platform.slug,
          symbol: coin.platform.symbol,
          tokenAddress: coin.platform.token_address
        }
      : null,
    tags: Array.isArray(coin?.tags) ? coin.tags : []
  };
}

export function dedupeCmcCategoryCoins(coins = []) {
  const bestBySlug = new Map();

  for (const coin of coins) {
    const key = String(coin.slug || coin.symbol || coin.id || "").toLowerCase();
    const existing = bestBySlug.get(key);
    const existingCap = Number(existing?.marketCap ?? -1);
    const nextCap = Number(coin?.marketCap ?? -1);

    if (!existing || nextCap > existingCap) {
      bestBySlug.set(key, coin);
    }
  }

  return [...bestBySlug.values()];
}

export function findCmcCategoryMatches(coins, query, limit = 10) {
  const normalized = String(query || "").trim().toLowerCase();

  const exact = coins.filter((coin) => {
    return (
      String(coin.symbol || "").toLowerCase() === normalized ||
      String(coin.slug || "").toLowerCase() === normalized ||
      String(coin.name || "").toLowerCase() === normalized
    );
  });

  const matches = exact.length
    ? exact
    : coins.filter((coin) => {
        return (
          String(coin.symbol || "").toLowerCase().includes(normalized) ||
          String(coin.slug || "").toLowerCase().includes(normalized) ||
          String(coin.name || "").toLowerCase().includes(normalized)
        );
      });

  return matches
    .sort((left, right) => {
      const marketCapDiff = Number(right.marketCap ?? -1) - Number(left.marketCap ?? -1);
      if (marketCapDiff !== 0) {
        return marketCapDiff;
      }

      return Number(right.volume24h ?? -1) - Number(left.volume24h ?? -1);
    })
    .slice(0, limit);
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
