import { toNumber } from "../lib/http.js";
import {
  fetchCmcRwaAssetTokens,
  fetchCmcRwaExchangeSummary,
  fetchCmcRwaMarketPairs,
  fetchCmcRwaSearchIndex,
  findCmcRwaMatches,
  isExactCmcMatch
} from "../lib/cmc.js";
import {
  enrichCoinGeckoToken,
  fetchCoinGeckoTokenizedGoldMarkets,
  findCoinGeckoTokenizedGoldMatches
} from "../lib/coingecko.js";

function mapCmcMatch(record) {
  return {
    id: record.id,
    name: record.name,
    symbol: record.symbol,
    slug: record.slug,
    type: Number(record.type) === 2 ? "commodity" : "equity",
    rank: toNumber(record.rank),
    status: record.status
  };
}

function mapCmcToken(token) {
  return {
    id: token.id,
    symbol: token.symbol,
    name: token.name,
    slug: token.slug,
    issuer: token.issuerName,
    price: toNumber(token.price),
    volume24h: toNumber(token.volume24h),
    marketCap: toNumber(token.marketCap),
    contractAddresses: token.contractAddresses ?? []
  };
}

function mapCmcMarketPair(pair) {
  return {
    exchange: pair.exchangeName,
    exchangeSlug: pair.exchangeSlug,
    marketPair: pair.marketPair,
    category: pair.category,
    marketUrl: pair.marketUrl,
    baseSymbol: pair.baseSymbol,
    quoteSymbol: pair.quoteSymbol,
    price: toNumber(pair.price),
    volume24h: toNumber(pair.volumeUsd),
    liquidityNeg2Pct: toNumber(pair.depthUsdNegativeTwo),
    liquidityPos2Pct: toNumber(pair.depthUsdPositiveTwo),
    effectiveLiquidity: toNumber(pair.effectiveLiquidity),
    lastUpdated: pair.lastUpdated
  };
}

function mapCmcExchange(exchange) {
  return {
    exchange: exchange.name,
    exchangeId: exchange.exchangeId,
    marketPairCount: toNumber(exchange.marketPairNum),
    volume24h: toNumber(exchange.volume24h),
    volumePercent: toNumber(exchange.volumePercent),
    liquidityScore: toNumber(exchange.liquidityScore)
  };
}

function mapCoinGeckoToken(token) {
  return {
    id: token.id,
    symbol: String(token.symbol || "").toUpperCase(),
    name: token.name,
    price: toNumber(token.current_price),
    volume24h: toNumber(token.total_volume),
    marketCap: toNumber(token.market_cap),
    marketCapRank: toNumber(token.market_cap_rank),
    categories: token.categories ?? [],
    supportedNetworks: token.supportedNetworks ?? []
  };
}

export async function discoverAssets(query, limit = 10) {
  const [cmcIndex, coinGeckoTokens] = await Promise.all([
    fetchCmcRwaSearchIndex(),
    fetchCoinGeckoTokenizedGoldMarkets().catch(() => [])
  ]);

  const cmcMatches = findCmcRwaMatches(cmcIndex, query, limit).map(mapCmcMatch);
  const cgMatches = findCoinGeckoTokenizedGoldMatches(coinGeckoTokens, query, limit);
  const coinGeckoMatches = await Promise.all(cgMatches.map((token) => enrichCoinGeckoToken(token)));

  let selectedCmc = null;
  let cmcTokens = [];
  let cmcMarketPairs = [];
  let cmcExchanges = [];

  if (cmcMatches.length > 0 && (cmcMatches.length === 1 || isExactCmcMatch(cmcMatches[0], query))) {
    selectedCmc = cmcMatches[0];
    const [tokens, marketPairs, exchanges] = await Promise.all([
      fetchCmcRwaAssetTokens(selectedCmc.slug, 20).catch(() => []),
      fetchCmcRwaMarketPairs(selectedCmc.slug, 20, "spot").catch(() => []),
      fetchCmcRwaExchangeSummary(selectedCmc.slug).catch(() => [])
    ]);

    cmcTokens = tokens.map(mapCmcToken);
    cmcMarketPairs = marketPairs.map(mapCmcMarketPair);
    cmcExchanges = exchanges.map(mapCmcExchange);
  }

  return {
    query,
    cmc: {
      matchCount: cmcMatches.length,
      matches: cmcMatches,
      selected: selectedCmc,
      tokens: cmcTokens,
      marketPairs: cmcMarketPairs,
      exchanges: cmcExchanges
    },
    coingecko: {
      matchCount: coinGeckoMatches.length,
      matches: coinGeckoMatches.map(mapCoinGeckoToken)
    }
  };
}
