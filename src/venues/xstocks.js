import { fetchJson, toNumber } from "../lib/http.js";
import {
  canonicalSymbol,
  inferCategory,
  isTradableRwaSymbol,
  resolveAliases,
  resolveAssetName
} from "../lib/assets.js";
import {
  fetchXstocksBirdeyeNetworkSummaries,
  fetchEtherscanTokenSummary,
  fetchXstocksOnchainMarkets,
  mergeXstocksNetworkBreakdown,
  summarizeBirdeyeNetworkSummaries
} from "../lib/xstocks.js";
import { estimatePreferredRouteLiquidity } from "../lib/route-liquidity.js";
import { networkDisplayName, tokenExplorerUrl } from "../lib/networks.js";
import { fetchRwaPlatformPage, fetchXstocksProductsPage, toRwaNetworkBreakdown, toRwaSupportedNetworks } from "../lib/rwaxyz.js";
import { sumMetric } from "../lib/onchain-data.js";

const QUOTE_URL = "https://api.xstocks.fi/api/v1/collateral/quote";

function withEthereumScannerFallback(rows, scannerSummary, ethereumAddress) {
  const hasScannerData = [scannerSummary?.holders, scannerSummary?.onchainMarketCap, scannerSummary?.circulatingMarketCap]
    .some((value) => value !== null && value !== undefined);

  if (!ethereumAddress || !hasScannerData) {
    return rows;
  }

  const next = [...rows];
  const index = next.findIndex((row) => row.network === "Ethereum");
  const existing = index >= 0
    ? next[index]
    : {
        network: "Ethereum",
        volume24h: 0,
        liquidityUsd: 0,
        liquidity2Pct: null,
        holders: null,
        marketCap: null,
        circulatingMarketCap: null,
        marketCount: 0,
        explorerUrl: "https://etherscan.io",
        sources: []
      };

  const merged = {
    ...existing,
    holders: existing.holders ?? scannerSummary.holders,
    marketCap: existing.marketCap ?? scannerSummary.onchainMarketCap,
    circulatingMarketCap: existing.circulatingMarketCap ?? scannerSummary.circulatingMarketCap,
    sources: [...new Set([...(existing.sources ?? []), "etherscan"])]
  };

  if (index >= 0) {
    next[index] = merged;
  } else {
    next.push(merged);
  }

  return next.sort((left, right) => (right.volume24h ?? 0) - (left.volume24h ?? 0));
}

function withEthereumOdosLiquidity(rows, odosLiquidity) {
  if (!odosLiquidity?.liquidityUsd) {
    return rows;
  }

  const next = [...rows];
  const index = next.findIndex((row) => row.network === "Ethereum");
  const existing = index >= 0
    ? next[index]
    : {
        network: "Ethereum",
        volume24h: 0,
        liquidityUsd: 0,
        liquidity2Pct: null,
        holders: null,
        marketCap: null,
        circulatingMarketCap: null,
        marketCount: 0,
        explorerUrl: "https://etherscan.io",
        sources: []
      };

  const merged = {
    ...existing,
    liquidity2Pct: odosLiquidity.liquidityUsd,
    sources: [...new Set([...(existing.sources ?? []), "odos_quote"])]
  };

  if (index >= 0) {
    next[index] = merged;
  } else {
    next.push(merged);
  }

  return next.sort((left, right) => (right.volume24h ?? 0) - (left.volume24h ?? 0));
}

function scopeForField(rows, field, supportedCount) {
  const coverage = (rows ?? []).filter((row) => row?.[field] !== null && row?.[field] !== undefined).length;
  if (coverage === 0) {
    return "missing";
  }
  if (coverage === 1) {
    return supportedCount > 1 ? "multichain_partial" : "single_chain";
  }
  return coverage >= supportedCount ? "multichain_sum" : "multichain_partial";
}

function sourcesForField(rows, field) {
  return [...new Set(
    (rows ?? [])
      .filter((row) => row?.[field] !== null && row?.[field] !== undefined)
      .flatMap((row) => row.sources ?? [])
  )];
}

function stripXstocksSuffix(name) {
  return String(name || "")
    .replace(/\s+xStock$/i, "")
    .trim();
}

function canonicalProductSymbol(productSymbol) {
  return canonicalSymbol(String(productSymbol || "").replace(/x$/i, ""));
}

function productNetworks(product) {
  return Object.entries(product.addresses ?? {})
    .map(([network, address]) => ({
      network: networkDisplayName(network),
      slug: network,
      address,
      explorerUrl: tokenExplorerUrl(network, address)
    }))
    .filter((entry) => entry.address);
}

async function fetchProducts() {
  return fetchXstocksProductsPage();
}

async function fetchPlatform() {
  return fetchRwaPlatformPage("xstocks");
}

async function fetchQuote(venueTicker) {
  const symbol = String(venueTicker || "").replace(/x$/i, "");
  const json = await fetchJson(`${QUOTE_URL}?symbol=${encodeURIComponent(symbol)}`, {}, 12000);
  return {
    price: toNumber(json?.quote),
    timestamp: json?.timestamp ?? null
  };
}

async function fetchProductDetails(product) {
  const ethereumAddress = product?.addresses?.ethereum ?? null;
  const [scannerSummary, birdeyeNetworkSummaries, onchainMarkets] = await Promise.all([
    fetchEtherscanTokenSummary(ethereumAddress),
    fetchXstocksBirdeyeNetworkSummaries(product?.addresses ?? {}),
    fetchXstocksOnchainMarkets(product?.addresses ?? {})
  ]);
  const birdeyeSummary = summarizeBirdeyeNetworkSummaries(birdeyeNetworkSummaries);
  const odosLiquidity = ethereumAddress && scannerSummary?.decimals
    ? await estimatePreferredRouteLiquidity(ethereumAddress, {
        network: "ethereum",
        decimals: scannerSummary.decimals,
        providers: ["odos_quote"]
      }).catch(() => null)
    : null;
  const onchainNetworkBreakdown = withEthereumOdosLiquidity(
    withEthereumScannerFallback(
      mergeXstocksNetworkBreakdown(onchainMarkets, birdeyeNetworkSummaries),
      scannerSummary,
      ethereumAddress
    ),
    odosLiquidity
  );

  return {
    scannerSummary,
    odosLiquidity,
    birdeyeSummary,
    birdeyeNetworkSummaries,
    onchainMarkets,
    onchainNetworkBreakdown
  };
}

function toProductMarket(product) {
  const symbol = canonicalProductSymbol(product.symbol);
  const strippedName = stripXstocksSuffix(product.name);
  const name = resolveAssetName(symbol, strippedName);

  return {
    venue: "xstocks",
    venueTicker: product.symbol,
    symbol,
    name,
    type: "spot",
    category: inferCategory(symbol, name),
    entityKind: "asset",
    executionModel: "onchain",
    aliases: resolveAliases(symbol, product.symbol, name),
    supportedNetworks: productNetworks(product),
    networkBreakdown: [],
    raw: product
  };
}

function toPlatformMarket(platform) {
  return {
    venue: "xstocks",
    venueTicker: "xstocks",
    symbol: "XSTOCKS",
    name: "xStocks Platform",
    type: "issuer",
    category: "issuer",
    entityKind: "issuer",
    executionModel: "issuer",
    aliases: [
      "xstocks",
      "xstock",
      "xstocks platform",
      "xstocks issuer"
    ],
    supportedNetworks: toRwaSupportedNetworks(platform.network_stats ?? []),
    networkBreakdown: toRwaNetworkBreakdown(platform.network_stats ?? []),
    raw: platform
  };
}

export async function listMarkets() {
  const [products, platform] = await Promise.all([fetchProducts(), fetchPlatform()]);
  const markets = products
    .map((product) => toProductMarket(product))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));

  if (platform) {
    markets.push(toPlatformMarket(platform));
  }

  return markets;
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const includePlatform = wanted.has("XSTOCKS");
  const [products, platform] = await Promise.all([
    fetchProducts(),
    includePlatform ? fetchPlatform() : Promise.resolve(null)
  ]);

  const matchedProducts = products
    .map((product) => toProductMarket(product))
    .filter((market) => wanted.has(market.symbol))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));

  const productQuotes = await Promise.all(
    matchedProducts.map(async (market) => {
      const product = products.find((entry) => entry.symbol === market.venueTicker);
      const [quote, details] = await Promise.all([
        fetchQuote(market.venueTicker).catch(() => ({ price: null, timestamp: null })),
        fetchProductDetails(product).catch(() => ({
          scannerSummary: {
            holders: null,
            onchainMarketCap: null,
            circulatingMarketCap: null,
            decimals: null
          },
          odosLiquidity: null,
          birdeyeSummary: {
            priceUsd: null,
            holders: null,
            marketCap: null,
            circulatingMarketCap: null,
            liquidityUsd: null,
            liquidity2Pct: null
          },
          onchainMarkets: [],
          onchainNetworkBreakdown: []
        }))
      ]);

      const supportedNetworkCount = market.supportedNetworks.length || 1;
      const topLevelTvl = sumMetric(details.onchainNetworkBreakdown, "liquidityUsd");
      const topLevelHolders = sumMetric(details.onchainNetworkBreakdown, "holders");
      const topLevelMarketCap = sumMetric(details.onchainNetworkBreakdown, "marketCap");
      const topLevelCirculatingMarketCap = sumMetric(details.onchainNetworkBreakdown, "circulatingMarketCap");
      const topLevelLiquidity2Pct =
        sumMetric(details.onchainNetworkBreakdown, "liquidity2Pct") ??
        (details.onchainMarkets.reduce((sum, entry) => sum + (entry.liquidity2Pct ?? 0), 0) || null);

      return {
        venue: "xstocks",
        venueTicker: market.venueTicker,
        symbol: market.symbol,
        name: market.name,
        type: "spot",
        category: market.category,
        entityKind: "asset",
        executionModel: "onchain",
        price: quote.price ?? details.birdeyeSummary.priceUsd,
        bid: null,
        ask: null,
        liquidity2Pct: topLevelLiquidity2Pct,
        volume24h: details.onchainMarkets.reduce((sum, entry) => sum + (entry.volume24h ?? 0), 0) || null,
        volume30d: null,
        totalValue: topLevelTvl,
        openInterest: null,
        fundingRate: null,
        fundingRateApr: null,
        holders: topLevelHolders,
        onchainMarketCap: topLevelMarketCap,
        circulatingMarketCap: topLevelCirculatingMarketCap,
        onchainMarketCount: sumMetric(details.onchainNetworkBreakdown, "marketCount") ?? details.onchainMarkets.length,
        supportedNetworks: market.supportedNetworks,
        networkBreakdown: [],
        onchainNetworkBreakdown: details.onchainNetworkBreakdown,
        onchainMarkets: details.onchainMarkets,
        fieldScopes: {
          price: quote.price !== null ? "issuer_quote" : "single_chain",
          totalValue: scopeForField(details.onchainNetworkBreakdown, "liquidityUsd", supportedNetworkCount),
          holders: scopeForField(details.onchainNetworkBreakdown, "holders", supportedNetworkCount),
          onchainMarketCap: scopeForField(details.onchainNetworkBreakdown, "marketCap", supportedNetworkCount),
          circulatingMarketCap: scopeForField(
            details.onchainNetworkBreakdown,
            "circulatingMarketCap",
            supportedNetworkCount
          ),
          volume24h: details.onchainMarkets.length > 0 ? "discovered_market_sum" : "missing",
          liquidity2Pct: scopeForField(details.onchainNetworkBreakdown, "liquidity2Pct", supportedNetworkCount)
        },
        fieldSources: {
          price: quote.price !== null ? ["xstocks_quote_api"] : ["birdeye"],
          totalValue: sourcesForField(details.onchainNetworkBreakdown, "liquidityUsd"),
          holders: sourcesForField(details.onchainNetworkBreakdown, "holders"),
          onchainMarketCap: sourcesForField(details.onchainNetworkBreakdown, "marketCap"),
          circulatingMarketCap: sourcesForField(details.onchainNetworkBreakdown, "circulatingMarketCap"),
          volume24h: ["markets"],
          liquidity2Pct: sourcesForField(details.onchainNetworkBreakdown, "liquidity2Pct")
        },
        source: `${QUOTE_URL}?symbol=${String(market.venueTicker).replace(/x$/i, "")}`
      };
    })
  );

  const quotes = [...productQuotes];

  if (platform && wanted.has("XSTOCKS")) {
    quotes.push({
      venue: "xstocks",
      venueTicker: "xstocks",
      symbol: "XSTOCKS",
      name: "xStocks Platform",
      type: "issuer",
      category: "issuer",
      entityKind: "issuer",
      executionModel: "issuer",
      price: null,
      bid: null,
      ask: null,
      liquidity2Pct: null,
      volume24h: null,
      volume30d: toNumber(platform.trailing_30_day_transfer_volume?.val),
      totalValue: toNumber(platform.bridged_token_value_dollar?.val),
      openInterest: null,
      fundingRate: null,
      fundingRateApr: null,
      supportedNetworks: toRwaSupportedNetworks(platform.network_stats ?? []),
      networkBreakdown: toRwaNetworkBreakdown(platform.network_stats ?? []),
      source: "https://app.rwa.xyz/platforms/xstocks"
    });
  }

  return quotes;
}
