import { toNumber } from "../lib/http.js";
import {
  dedupeCmcCategoryCoins,
  fetchUniblockCmcDiscoveryCategories,
  fetchCmcRwaAssetTokens,
  fetchCmcRwaExchangeSummary,
  fetchCmcRwaMarketPairs,
  fetchCmcRwaSearchIndex,
  findCmcRwaMatches,
  findCmcCategoryMatches,
  isExactCmcMatch,
  normalizeCmcCategoryCoin
} from "../lib/cmc.js";
import {
  enrichCoinGeckoToken,
  fetchCoinGeckoDiscoveryMarkets,
  findCoinGeckoMatches
} from "../lib/coingecko.js";
import { fetchDinariDsharesList, findDinariDsharesMatches } from "../lib/dinari.js";

function nullableToNumber(value) {
  return value === null || value === undefined || value === "" ? null : toNumber(value);
}

function mapCmcMatch(record) {
  return {
    id: record.id,
    name: record.name,
    symbol: record.symbol,
    slug: record.slug,
    type: Number(record.type) === 2 ? "commodity" : "equity",
    rank: nullableToNumber(record.rank),
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
    price: nullableToNumber(token.price),
    volume24h: nullableToNumber(token.volume24h),
    marketCap: nullableToNumber(token.marketCap),
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
    price: nullableToNumber(pair.price),
    volume24h: nullableToNumber(pair.volumeUsd),
    liquidityNeg2Pct: nullableToNumber(pair.depthUsdNegativeTwo),
    liquidityPos2Pct: nullableToNumber(pair.depthUsdPositiveTwo),
    effectiveLiquidity: nullableToNumber(pair.effectiveLiquidity),
    lastUpdated: pair.lastUpdated
  };
}

function mapCmcExchange(exchange) {
  return {
    exchange: exchange.name,
    exchangeId: exchange.exchangeId,
    marketPairCount: nullableToNumber(exchange.marketPairNum),
    volume24h: nullableToNumber(exchange.volume24h),
    volumePercent: nullableToNumber(exchange.volumePercent),
    liquidityScore: nullableToNumber(exchange.liquidityScore)
  };
}

function mapCoinGeckoToken(token) {
  return {
    id: token.id,
    symbol: String(token.symbol || "").toUpperCase(),
    name: token.name,
    price: nullableToNumber(token.current_price),
    volume24h: nullableToNumber(token.total_volume),
    marketCap: nullableToNumber(token.market_cap),
    marketCapRank: nullableToNumber(token.market_cap_rank),
    categories: token.categories ?? [],
    discoveryCategories: token.discoveryCategories ?? [],
    supportedNetworks: token.supportedNetworks ?? []
  };
}

function mapDinariMatch(record) {
  return {
    symbol: record.symbol,
    venueTicker: record.venueTicker,
    name: record.name,
    issuer: record.issuer,
    imageUrl: record.imageUrl ?? null
  };
}

function mapDinariCmcToken(token) {
  return {
    id: token.id,
    symbol: String(token.symbol || "").toUpperCase(),
    name: token.name,
    slug: token.slug,
    issuer: token.issuer ?? null,
    price: nullableToNumber(token.price),
    volume24h: nullableToNumber(token.volume24h),
    marketCap: nullableToNumber(token.marketCap),
    contractAddresses: token.contractAddresses ?? []
  };
}

function tokenMergeKey(token) {
  return String(token.slug || token.symbol || token.id || "")
    .trim()
    .toLowerCase();
}

function toSnapshotTokenFromCmcToken(token) {
  return {
    id: token.id ?? null,
    symbol: String(token.symbol || "").toUpperCase(),
    name: token.name ?? null,
    slug: token.slug ?? null,
    issuer: token.issuer ?? null,
    price: nullableToNumber(token.price),
    volume24h: nullableToNumber(token.volume24h),
    marketCap: nullableToNumber(token.marketCap),
    numMarketPairs: null,
    platform: null,
    contractAddresses: token.contractAddresses ?? [],
    supportedNetworks: [],
    discoveryCategories: [],
    sourceTags: ["cmc-rwa-token"]
  };
}

function toSnapshotTokenFromCmcCategory(token) {
  return {
    id: token.id ?? null,
    symbol: String(token.symbol || "").toUpperCase(),
    name: token.name ?? null,
    slug: token.slug ?? null,
    issuer: null,
    price: nullableToNumber(token.price),
    volume24h: nullableToNumber(token.volume24h),
    marketCap: nullableToNumber(token.marketCap),
    numMarketPairs: nullableToNumber(token.numMarketPairs),
    platform: token.platform ?? null,
    contractAddresses: token.platform?.tokenAddress ? [token.platform.tokenAddress] : [],
    supportedNetworks: [],
    discoveryCategories: token.category ? [token.category] : [],
    sourceTags: ["cmc-category"]
  };
}

function toSnapshotTokenFromCoinGecko(token) {
  return {
    id: token.id ?? null,
    symbol: String(token.symbol || "").toUpperCase(),
    name: token.name ?? null,
    slug: token.id ?? null,
    issuer: null,
    price: nullableToNumber(token.price),
    volume24h: nullableToNumber(token.volume24h),
    marketCap: nullableToNumber(token.marketCap),
    numMarketPairs: null,
    platform: null,
    contractAddresses: [],
    supportedNetworks: token.supportedNetworks ?? [],
    discoveryCategories: [...new Set([...(token.categories ?? []), ...(token.discoveryCategories ?? [])])],
    sourceTags: ["coingecko"]
  };
}

function mergeSnapshotTokens(tokens = []) {
  const merged = new Map();

  for (const token of tokens) {
    const key = tokenMergeKey(token);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        ...token,
        contractAddresses: [...new Set(token.contractAddresses ?? [])],
        supportedNetworks: token.supportedNetworks ?? [],
        discoveryCategories: [...new Set(token.discoveryCategories ?? [])],
        sourceTags: [...new Set(token.sourceTags ?? [])]
      });
      continue;
    }

    const existingMarketCap = Number(existing.marketCap ?? -1);
    const nextMarketCap = Number(token.marketCap ?? -1);
    const preferred = nextMarketCap > existingMarketCap ? token : existing;

    merged.set(key, {
      id: preferred.id ?? existing.id ?? token.id ?? null,
      symbol: preferred.symbol ?? existing.symbol ?? null,
      name: preferred.name ?? existing.name ?? null,
      slug: preferred.slug ?? existing.slug ?? null,
      issuer: existing.issuer ?? token.issuer ?? null,
      price: preferred.price ?? existing.price ?? null,
      volume24h: preferred.volume24h ?? existing.volume24h ?? null,
      marketCap: preferred.marketCap ?? existing.marketCap ?? null,
      numMarketPairs: existing.numMarketPairs ?? token.numMarketPairs ?? null,
      platform: existing.platform ?? token.platform ?? null,
      contractAddresses: [...new Set([...(existing.contractAddresses ?? []), ...(token.contractAddresses ?? [])])],
      supportedNetworks: [...(existing.supportedNetworks ?? []), ...(token.supportedNetworks ?? [])].filter(Boolean),
      discoveryCategories: [...new Set([...(existing.discoveryCategories ?? []), ...(token.discoveryCategories ?? [])])],
      sourceTags: [...new Set([...(existing.sourceTags ?? []), ...(token.sourceTags ?? [])])]
    });
  }

  return [...merged.values()].sort((left, right) => {
    const marketCapDiff = Number(right.marketCap ?? -1) - Number(left.marketCap ?? -1);
    if (marketCapDiff !== 0) {
      return marketCapDiff;
    }

    return Number(right.volume24h ?? -1) - Number(left.volume24h ?? -1);
  });
}

function mapCmcCategoryToken(token) {
  return {
    id: token.id,
    symbol: String(token.symbol || "").toUpperCase(),
    name: token.name,
    slug: token.slug,
    category: token.categoryName,
    price: toNumber(token.price),
    volume24h: toNumber(token.volume24h),
    marketCap: toNumber(token.marketCap),
    numMarketPairs: toNumber(token.numMarketPairs),
    platform: token.platform ?? null
  };
}

export async function discoverAssets(query, limit = 10) {
  const [cmcIndex, coinGeckoTokens, cmcCategoryPayloads, dinariAssets] = await Promise.all([
    fetchCmcRwaSearchIndex(),
    fetchCoinGeckoDiscoveryMarkets().catch(() => []),
    fetchUniblockCmcDiscoveryCategories().catch(() => []),
    fetchDinariDsharesList().catch(() => [])
  ]);

  const cmcMatches = findCmcRwaMatches(cmcIndex, query, limit).map(mapCmcMatch);
  const cmcCategoryTokens = dedupeCmcCategoryCoins(
    cmcCategoryPayloads.flatMap((category) =>
      (category.payload?.coins ?? []).map((coin) =>
        normalizeCmcCategoryCoin(coin, category)
      )
    )
  );
  const cmcCategoryMatches = findCmcCategoryMatches(cmcCategoryTokens, query, limit).map(mapCmcCategoryToken);
  const cgMatches = findCoinGeckoMatches(coinGeckoTokens, query, limit);
  const coinGeckoMatches = await Promise.all(cgMatches.map((token) => enrichCoinGeckoToken(token)));
  const dinariMatches = findDinariDsharesMatches(dinariAssets, query, limit).map(mapDinariMatch);

  let selectedCmc = null;
  let cmcTokens = [];
  let cmcMarketPairs = [];
  let cmcExchanges = [];
  let dinariTokens = [];

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
    dinariTokens = cmcTokens
      .filter(
        (token) =>
          String(token.issuer || "").toLowerCase().includes("dinari") ||
          String(token.symbol || "").toUpperCase().endsWith(".D")
      )
      .map(mapDinariCmcToken);
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
    cmcCategories: {
      categoryCount: cmcCategoryPayloads.length,
      matchCount: cmcCategoryMatches.length,
      categories: cmcCategoryPayloads.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        tokenCount: toNumber(category.payload?.num_tokens ?? category.payload?.coins?.length)
      })),
      matches: cmcCategoryMatches
    },
    dinari: {
      matchCount: dinariMatches.length,
      matches: dinariMatches,
      tokenMatchCount: dinariTokens.length,
      tokens: dinariTokens
    },
    coingecko: {
      matchCount: coinGeckoMatches.length,
      matches: coinGeckoMatches.map(mapCoinGeckoToken)
    }
  };
}

export function buildDiscoverySnapshot(payload) {
  const tokens = mergeSnapshotTokens([
    ...(payload.cmc?.tokens ?? []).map(toSnapshotTokenFromCmcToken),
    ...(payload.cmcCategories?.matches ?? []).map(toSnapshotTokenFromCmcCategory),
    ...(payload.coingecko?.matches ?? []).map(toSnapshotTokenFromCoinGecko)
  ]);

  return {
    query: payload.query,
    generatedAt: new Date().toISOString(),
    underlyings: {
      selected: payload.cmc?.selected ?? null,
      matches: payload.cmc?.matches ?? []
    },
    tokens,
    venuePairs: payload.cmc?.marketPairs ?? [],
    exchanges: payload.cmc?.exchanges ?? [],
    categories: payload.cmcCategories?.categories ?? [],
    dinari: {
      matches: payload.dinari?.matches ?? [],
      tokens: payload.dinari?.tokens ?? []
    },
    sources: {
      cmcRwa: Boolean(payload.cmc?.matches?.length),
      cmcCategories: Boolean(payload.cmcCategories?.categoryCount),
      coingecko: Boolean(payload.coingecko?.matchCount),
      dinari: Boolean(payload.dinari?.matchCount)
    },
    summary: {
      tokenCount: tokens.length,
      venuePairCount: payload.cmc?.marketPairs?.length ?? 0,
      exchangeCount: payload.cmc?.exchanges?.length ?? 0,
      categoryCount: payload.cmcCategories?.categoryCount ?? 0,
      dinariMatchCount: payload.dinari?.matchCount ?? 0
    }
  };
}
