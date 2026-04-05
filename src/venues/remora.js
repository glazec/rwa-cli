import {
  enrichCoinGeckoToken,
  fetchCoinGeckoCategoryMarkets,
  fetchCoinGeckoOnchainTokenInfo
} from "../lib/coingecko.js";
import { fetchBirdeyeTokenMarketData, fetchBirdeyeTokenMarkets, toBirdeyeMarkets } from "../lib/birdeye.js";
import { canonicalSymbol, inferCategory, isTradableRwaSymbol, resolveAliases, resolveAssetName } from "../lib/assets.js";
import { fetchRwaPlatformPage, toRwaNetworkBreakdown, toRwaSupportedNetworks } from "../lib/rwaxyz.js";
import { optionalNumber } from "../lib/onchain-data.js";
import { estimatePreferredRouteLiquidity } from "../lib/route-liquidity.js";

const REMORA_CATEGORY = "remora-markets-tokenized-rstocks";
const REMORA_PLATFORM_SLUG = "remora-markets";

function remoraUnderlyingSymbol(token) {
  const rawSymbol = String(token?.symbol || "").trim().toUpperCase();
  const rawName = String(token?.name || "").trim();

  if (rawName === "Gold rStock") {
    return "XAU";
  }
  if (rawName === "Silver rStock") {
    return "XAG";
  }
  if (rawName === "Copper rStock") {
    return "XCU";
  }
  if (rawName === "Platinum rStock") {
    return "XPT";
  }
  if (rawName === "Palladium rStock") {
    return "XPD";
  }

  if (rawSymbol.endsWith("R") && rawSymbol.length > 1) {
    return canonicalSymbol(rawSymbol.slice(0, -1));
  }

  return canonicalSymbol(rawSymbol);
}

function remoraUnderlyingName(symbol, tokenName) {
  const rawName = String(tokenName || "").trim();
  if (rawName.endsWith(" rStock")) {
    return rawName.slice(0, -" rStock".length);
  }

  return resolveAssetName(symbol, rawName || symbol);
}

async function fetchRemoraIssuerPlatform() {
  const platform = await fetchRwaPlatformPage(REMORA_PLATFORM_SLUG);
  if (!platform) {
    throw new Error(`Could not load RWA.xyz platform page for ${REMORA_PLATFORM_SLUG}`);
  }
  return platform;
}

async function fetchRemoraTokens() {
  const tokens = await fetchCoinGeckoCategoryMarkets(REMORA_CATEGORY);
  const enriched = await Promise.all(tokens.map((token) => enrichCoinGeckoToken(token)));
  return enriched
    .map((token) => {
      const symbol = remoraUnderlyingSymbol(token);
      const name = remoraUnderlyingName(symbol, token.name);
      const venueTicker = String(token.symbol || "").toUpperCase();

      return {
        venue: "remora",
        venueTicker,
        symbol,
        name,
        type: "spot",
        category: inferCategory(symbol, name),
        entityKind: "asset",
        executionModel: "onchain",
        aliases: [
          ...resolveAliases(symbol, venueTicker, name),
          token.id,
          token.name,
          String(token.name || "").toLowerCase()
        ].filter(Boolean),
        supportedNetworks: token.supportedNetworks ?? [],
        raw: token
      };
    })
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

function issuerMarket(platform) {
  return {
    venue: "remora",
    venueTicker: "remora",
    symbol: canonicalSymbol("REMORA"),
    name: "Remora Markets",
    type: "issuer",
    category: "issuer",
    entityKind: "issuer",
    executionModel: "issuer",
    aliases: [
      ...resolveAliases("REMORA", "remora", "Remora Markets"),
      REMORA_PLATFORM_SLUG
    ],
    supportedNetworks: toRwaSupportedNetworks(platform.network_stats ?? []),
    networkBreakdown: toRwaNetworkBreakdown(platform.network_stats ?? []),
    raw: platform
  };
}

function issuerQuote(platform) {
  const networkBreakdown = toRwaNetworkBreakdown(platform.network_stats ?? []);
  return {
    venue: "remora",
    venueTicker: "remora",
    symbol: canonicalSymbol("REMORA"),
    name: "Remora Markets",
    type: "issuer",
    category: "issuer",
    entityKind: "issuer",
    executionModel: "issuer",
    price: null,
    bid: null,
    ask: null,
    liquidity2Pct: null,
    volume24h: null,
    volume30d: optionalNumber(platform.trailing_30_day_transfer_volume?.val),
    holders: optionalNumber(platform.holding_addresses_count?.val),
    totalValue: optionalNumber(platform.bridged_token_value_dollar?.val),
    onchainMarketCap: optionalNumber(platform.bridged_token_market_cap_dollar?.val),
    circulatingMarketCap: optionalNumber(platform.circulating_asset_value_dollar?.val),
    openInterest: null,
    fundingRate: null,
    fundingRateApr: null,
    supportedNetworks: toRwaSupportedNetworks(platform.network_stats ?? []),
    networkBreakdown,
    onchainNetworkBreakdown: networkBreakdown,
    source: `https://app.rwa.xyz/platforms/${REMORA_PLATFORM_SLUG}`
  };
}

async function enrichRemoraTokenQuote(quote) {
  const supportedNetworks = quote.supportedNetworks ?? [];
  const primaryNetwork = supportedNetworks.find((entry) => entry.slug === "solana" && entry.address) ?? supportedNetworks[0] ?? null;
  const onchainInfo = primaryNetwork?.address
    ? await fetchCoinGeckoOnchainTokenInfo(primaryNetwork.address, primaryNetwork.slug).catch(() => null)
    : null;
  const [marketData, markets] = primaryNetwork?.address
    ? await Promise.all([
        fetchBirdeyeTokenMarketData(primaryNetwork.address, primaryNetwork.slug).catch(() => null),
        fetchBirdeyeTokenMarkets(primaryNetwork.address, primaryNetwork.slug).catch(() => [])
      ])
    : [null, []];
  const jupiterLiquidity =
    primaryNetwork?.slug === "solana" && primaryNetwork?.address
      ? await estimatePreferredRouteLiquidity(primaryNetwork.address, {
          network: primaryNetwork.slug,
          providers: ["jupiter_quote"]
        }).catch(() => null)
      : null;

  const onchainMarkets = primaryNetwork?.address
    ? toBirdeyeMarkets(markets, primaryNetwork.address, primaryNetwork.slug)
    : [];

  const onchainNetworkBreakdown = primaryNetwork
    ? [
        {
          network: primaryNetwork.network,
          slug: primaryNetwork.slug,
          explorerUrl: primaryNetwork.explorerUrl,
          volume24h: optionalNumber(quote.raw?.total_volume),
          liquidityUsd: optionalNumber(marketData?.liquidity),
          liquidity2Pct: optionalNumber(jupiterLiquidity?.liquidityUsd),
          holders: optionalNumber(onchainInfo?.holders?.count) ?? optionalNumber(marketData?.holder),
          holderDistribution: onchainInfo?.holders?.distribution_percentage ?? null,
          holdersLastUpdated: onchainInfo?.holders?.last_updated ?? null,
          topHolders: [],
          marketCap: optionalNumber(marketData?.market_cap) ?? optionalNumber(quote.raw?.market_cap),
          circulatingMarketCap: optionalNumber(marketData?.market_cap) ?? optionalNumber(quote.raw?.market_cap),
          marketCount: onchainMarkets.length || null,
          sources: [
            ...(marketData ? ["birdeye"] : []),
            ...(onchainInfo?.holders?.count ? ["coingecko"] : []),
            ...(jupiterLiquidity?.liquidityUsd ? ["jupiter_quote"] : [])
          ]
        }
      ]
    : [];

  const topLevel = onchainNetworkBreakdown[0] ?? null;

  return {
    ...quote,
    price: optionalNumber(marketData?.price) ?? optionalNumber(quote.raw?.current_price),
    volume24h: optionalNumber(quote.raw?.total_volume),
    holders: topLevel?.holders ?? null,
    totalValue: topLevel?.liquidityUsd ?? null,
    onchainMarketCap: topLevel?.marketCap ?? null,
    circulatingMarketCap: topLevel?.circulatingMarketCap ?? null,
    onchainMarketCount: topLevel?.marketCount ?? null,
    liquidity2Pct: topLevel?.liquidity2Pct ?? null,
    supportedNetworks,
    onchainNetworkBreakdown,
    onchainMarkets,
    source: `CoinGecko category ${REMORA_CATEGORY} + Birdeye + Jupiter`,
    raw: {
      token: quote.raw,
      onchainInfo,
      birdeyeSummary: marketData,
      jupiterLiquidity,
      onchainMarkets
    }
  };
}

export async function listMarkets() {
  const [platform, remoraTokens] = await Promise.all([
    fetchRemoraIssuerPlatform().catch(() => null),
    fetchRemoraTokens()
  ]);

  return [
    ...(platform ? [issuerMarket(platform)] : []),
    ...remoraTokens
  ];
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const [platform, remoraTokens] = await Promise.all([
    fetchRemoraIssuerPlatform().catch(() => null),
    fetchRemoraTokens()
  ]);

  const quotes = [];
  if (platform && wanted.has("REMORA")) {
    quotes.push(issuerQuote(platform));
  }

  const matched = remoraTokens.filter((quote) => wanted.has(quote.symbol));
  const enriched = await Promise.all(
    matched.map((quote) =>
      enrichRemoraTokenQuote({
        ...quote,
        bid: null,
        ask: null,
        openInterest: null,
        fundingRate: null,
        fundingRateApr: null
      })
    )
  );

  return [...quotes, ...enriched];
}
