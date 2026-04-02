import { fetchJson } from "./http.js";
import { tokenExplorerUrl } from "./networks.js";

const COINGECKO_PUBLIC_API_URL = "https://api.coingecko.com/api/v3";
const COINGECKO_PRO_API_URL = "https://pro-api.coingecko.com/api/v3";
const TOKENIZED_GOLD_CATEGORY = "tokenized-gold";

const detailCache = new Map();
let tokenizedGoldCache = null;

function dedupeByCanonicalSymbol(tokens) {
  const bestBySymbol = new Map();

  for (const token of tokens) {
    const symbol = String(token.symbol || "").trim().toUpperCase();
    const existing = bestBySymbol.get(symbol);
    const existingMarketCap = Number(existing?.market_cap ?? -1);
    const nextMarketCap = Number(token.market_cap ?? -1);

    if (!existing || nextMarketCap > existingMarketCap) {
      bestBySymbol.set(symbol, token);
    }
  }

  return [...bestBySymbol.values()];
}

function coinGeckoHeaders() {
  const apiKey = process.env.COINGECKO_API_KEY || process.env.COINGECKO_PRO_API_KEY;

  return apiKey
    ? {
        "x-cg-pro-api-key": apiKey
      }
    : {};
}

function coinGeckoApiUrl() {
  const apiKey = process.env.COINGECKO_API_KEY || process.env.COINGECKO_PRO_API_KEY;
  return apiKey ? COINGECKO_PRO_API_URL : COINGECKO_PUBLIC_API_URL;
}

export async function fetchCoinGeckoTokenizedGoldMarkets() {
  if (tokenizedGoldCache) {
    return tokenizedGoldCache;
  }

  const json = await fetchJson(
    `${coinGeckoApiUrl()}/coins/markets?vs_currency=usd&category=${TOKENIZED_GOLD_CATEGORY}&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h`,
    {
      headers: coinGeckoHeaders()
    },
    15000
  );

  tokenizedGoldCache = dedupeByCanonicalSymbol(Array.isArray(json) ? json : []);
  return tokenizedGoldCache;
}

export async function fetchCoinGeckoCoinDetail(id) {
  if (detailCache.has(id)) {
    return detailCache.get(id);
  }

  const detail = await fetchJson(
    `${coinGeckoApiUrl()}/coins/${encodeURIComponent(
      id
    )}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`,
    {
      headers: coinGeckoHeaders()
    },
    15000
  );

  detailCache.set(id, detail);
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
      supportedNetworks
    };
  } catch {
    return {
      ...coin,
      categories: [],
      supportedNetworks: []
    };
  }
}

export function findCoinGeckoTokenizedGoldMatches(tokens, query, limit = 10) {
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
