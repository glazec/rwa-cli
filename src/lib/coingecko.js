import { fetchJson } from "./http.js";
import { normalizeNetworkKey, tokenExplorerUrl } from "./networks.js";
import { getOrSetCachedJson } from "./cache.js";
import { getSetting } from "./config.js";

const COINGECKO_PUBLIC_API_URL = "https://api.coingecko.com/api/v3";
const COINGECKO_PRO_API_URL = "https://pro-api.coingecko.com/api/v3";
const TOKENIZED_GOLD_CATEGORY = "tokenized-gold";
export const COINGECKO_DISCOVERY_CATEGORIES = [
  TOKENIZED_GOLD_CATEGORY,
  "tokenized-silver",
  "tokenized-commodities",
  "tokenized-stock",
  "tokenized-exchange-traded-funds-etfs",
  "tokenized-products",
  "real-estate",
  "tokenized-t-bills",
  "tokenized-treasury-bonds-t-bonds",
  "xstocks-ecosystem",
  "remora-markets-tokenized-rstocks",
  "ondo-tokenized-assets"
];

const detailCache = new Map();
const discoveryCategoryCache = new Map();
const onchainTokenInfoCache = new Map();

const COINGECKO_ONCHAIN_NETWORKS = {
  ethereum: "eth",
  base: "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  polygon: "polygon_pos",
  bnb: "bsc",
  bnbchain: "bsc",
  bsc: "bsc",
  solana: "solana",
  ton: "ton",
  sui: "sui"
};

function dedupeDiscoveryTokens(tokens) {
  const bestBySymbol = new Map();

  for (const token of tokens) {
    const symbol = String(token.symbol || "").trim().toUpperCase();
    const existing = bestBySymbol.get(symbol);
    const existingMarketCap = Number(existing?.market_cap ?? -1);
    const nextMarketCap = Number(token.market_cap ?? -1);
    const preferred = !existing || nextMarketCap > existingMarketCap ? token : existing;

    bestBySymbol.set(symbol, {
      ...preferred,
      discoveryCategories: [
        ...new Set([...(existing?.discoveryCategories ?? []), ...(token.discoveryCategories ?? [])])
      ]
    });
  }

  return [...bestBySymbol.values()];
}

function coinGeckoHeaders() {
  const apiKey = getSetting("COINGECKO_API_KEY", ["COINGECKO_PRO_API_KEY"]);

  return apiKey
    ? {
        "x-cg-pro-api-key": apiKey
      }
    : {};
}

function coinGeckoApiUrl() {
  const apiKey = getSetting("COINGECKO_API_KEY", ["COINGECKO_PRO_API_KEY"]);
  return apiKey ? COINGECKO_PRO_API_URL : COINGECKO_PUBLIC_API_URL;
}

export function coinGeckoOnchainNetworkForNetwork(network) {
  return COINGECKO_ONCHAIN_NETWORKS[normalizeNetworkKey(network)] ?? null;
}

export async function fetchCoinGeckoTokenizedGoldMarkets() {
  return fetchCoinGeckoCategoryMarkets(TOKENIZED_GOLD_CATEGORY);
}

export async function fetchCoinGeckoCategoryMarkets(category) {
  if (discoveryCategoryCache.has(category)) {
    return discoveryCategoryCache.get(category);
  }

  const markets = await getOrSetCachedJson(`coingecko-category-${category}-markets-v1`, async () => {
    const json = await fetchJson(
      `${coinGeckoApiUrl()}/coins/markets?vs_currency=usd&category=${encodeURIComponent(
        category
      )}&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h`,
      {
        headers: coinGeckoHeaders()
      },
      15000
    );

    return (Array.isArray(json) ? json : []).map((token) => ({
      ...token,
      discoveryCategories: [category]
    }));
  });

  discoveryCategoryCache.set(category, markets);
  return markets;
}

export async function fetchCoinGeckoDiscoveryMarkets() {
  const categories = await Promise.all(
    COINGECKO_DISCOVERY_CATEGORIES.map(async (category) => {
      try {
        return await fetchCoinGeckoCategoryMarkets(category);
      } catch {
        return [];
      }
    })
  );

  return dedupeDiscoveryTokens(categories.flat());
}

export async function fetchCoinGeckoCoinDetail(id) {
  if (detailCache.has(id)) {
    return detailCache.get(id);
  }

  const detail = await getOrSetCachedJson(`coingecko-coin-detail-${id}-v1`, async () => {
    return await fetchJson(
      `${coinGeckoApiUrl()}/coins/${encodeURIComponent(
        id
      )}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`,
      {
        headers: coinGeckoHeaders()
      },
      15000
    );
  });

  detailCache.set(id, detail);
  return detail;
}

export async function fetchCoinGeckoOnchainTokenInfo(address, network) {
  const onchainNetwork = coinGeckoOnchainNetworkForNetwork(network);
  if (!address || !onchainNetwork) {
    return null;
  }

  const cacheKey = `coingecko-onchain-token-info-${onchainNetwork}-${String(address).toLowerCase()}`;
  if (onchainTokenInfoCache.has(cacheKey)) {
    return onchainTokenInfoCache.get(cacheKey);
  }

  const detail = await getOrSetCachedJson(cacheKey, async () => {
    const json = await fetchJson(
      `${coinGeckoApiUrl()}/onchain/networks/${encodeURIComponent(onchainNetwork)}/tokens/${encodeURIComponent(address)}/info`,
      {
        headers: coinGeckoHeaders()
      },
      15000
    );

    return json?.data?.attributes ?? null;
  });

  onchainTokenInfoCache.set(cacheKey, detail);
  return detail;
}

export async function enrichCoinGeckoToken(coin) {
  try {
    const detail = await fetchCoinGeckoCoinDetail(coin.id);
    const supportedNetworks = Object.entries(detail?.platforms ?? {})
      .map(([network, address]) => ({
        network,
        slug: network,
        address,
        explorerUrl: tokenExplorerUrl(network, address)
      }))
      .filter((entry) => entry.address);

    return {
      ...coin,
      categories: detail?.categories ?? [],
      discoveryCategories: coin.discoveryCategories ?? [],
      supportedNetworks
    };
  } catch {
    return {
      ...coin,
      categories: [],
      discoveryCategories: coin.discoveryCategories ?? [],
      supportedNetworks: []
    };
  }
}

export function findCoinGeckoMatches(tokens, query, limit = 10) {
  const normalized = String(query || "").trim().toLowerCase();

  return tokens
    .filter((token) => {
      return (
        String(token.symbol || "").toLowerCase() === normalized ||
        String(token.name || "").toLowerCase() === normalized ||
        String(token.symbol || "").toLowerCase().includes(normalized) ||
        String(token.name || "").toLowerCase().includes(normalized)
      );
    })
    .slice(0, limit);
}

export function findCoinGeckoTokenizedGoldMatches(tokens, query, limit = 10) {
  return findCoinGeckoMatches(tokens, query, limit);
}
