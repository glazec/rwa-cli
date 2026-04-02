import {
  canonicalSymbol,
  inferCategory,
  resolveAliases,
  resolveAssetName
} from "../lib/assets.js";
import { toNumber } from "../lib/http.js";
import {
  enrichCoinGeckoToken,
  fetchCoinGeckoTokenizedGoldMarkets
} from "../lib/coingecko.js";

function coinGeckoSourceUrl() {
  return process.env.COINGECKO_API_KEY || process.env.COINGECKO_PRO_API_KEY
    ? "https://pro-api.coingecko.com/api/v3/coins/markets?category=tokenized-gold"
    : "https://api.coingecko.com/api/v3/coins/markets?category=tokenized-gold";
}

function toMarket(token) {
  const symbol = canonicalSymbol(token.symbol);
  const name = resolveAssetName(symbol, token.name);

  return {
    venue: "coingecko",
    venueTicker: String(token.symbol || "").toUpperCase(),
    symbol,
    name,
    type: "spot",
    category: inferCategory(symbol, name),
    aliases: resolveAliases(symbol, token.symbol, name),
    raw: token
  };
}

export async function listMarkets() {
  const tokens = await fetchCoinGeckoTokenizedGoldMarkets();
  return tokens
    .filter((token) => token.current_price !== null)
    .map((token) => toMarket(token));
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const tokens = await fetchCoinGeckoTokenizedGoldMarkets();
  const matched = tokens
    .filter((token) => token.current_price !== null)
    .filter((token) => wanted.has(canonicalSymbol(token.symbol)));

  return await Promise.all(
    matched.map(async (token) => {
      const enriched = await enrichCoinGeckoToken(token);
      const symbol = canonicalSymbol(token.symbol);
      const name = resolveAssetName(symbol, token.name);

      return {
        venue: "coingecko",
        venueTicker: String(token.symbol || "").toUpperCase(),
        symbol,
        name,
        type: "spot",
        price: toNumber(token.current_price),
        bid: null,
        ask: null,
        liquidity2Pct: null,
        volume24h: toNumber(token.total_volume),
        volume30d: null,
        totalValue: toNumber(token.market_cap),
        openInterest: null,
        fundingRate: null,
        fundingRateApr: null,
        category: inferCategory(symbol, name),
        supportedNetworks: enriched.supportedNetworks ?? [],
        networkBreakdown: [],
        source: coinGeckoSourceUrl()
      };
    })
  );
}
