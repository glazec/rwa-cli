import { fetchOndoAssetInfo, fetchOndoAssets, ONDO_APP_ASSETS_URL } from "../lib/ondo-app.js";
import { fetchBirdeyeTokenMarketData, fetchBirdeyeTokenMarkets, toBirdeyeMarkets } from "../lib/birdeye.js";
import { fetchCoinGeckoOnchainTokenInfo } from "../lib/coingecko.js";
import { canonicalSymbol, inferCategory, isTradableRwaSymbol, resolveAliases, resolveAssetName } from "../lib/assets.js";
import { fetchOkxTopTokenHolders } from "../lib/okx.js";
import { networkDisplayName, normalizeNetworkKey, tokenExplorerUrl } from "../lib/networks.js";
import { optionalNumber, sortNetworkRows, sumMetric } from "../lib/onchain-data.js";
import { estimatePreferredRouteLiquidityByNetworks } from "../lib/route-liquidity.js";

const ONDO_LIQUIDITY_PROVIDER_PRIORITIES = {
  ethereum: ["lifi_quote", "odos_quote", "oneinch_quote", "okx_quote"],
  bnb: ["lifi_quote", "oneinch_quote", "odos_quote", "okx_quote"],
  base: ["odos_quote", "oneinch_quote"],
  arbitrum: ["odos_quote", "oneinch_quote"],
  optimism: ["odos_quote", "oneinch_quote"],
  polygon: ["odos_quote", "oneinch_quote"]
};

function networkSlugForOndoNetwork(value) {
  const key = normalizeNetworkKey(value);

  if (key === "ethereum") {
    return "ethereum";
  }
  if (key === "bsc") {
    return "bnb";
  }
  if (key === "solana") {
    return "solana";
  }

  return key || null;
}

function mapSupportedNetworks(supportedNetworks = []) {
  return supportedNetworks
    .map((entry) => {
      const slug = networkSlugForOndoNetwork(entry.network ?? entry.chainId);
      const address = entry.address ?? null;

      return {
        network: networkDisplayName(slug || entry.network),
        slug,
        address,
        decimals: optionalNumber(entry.decimals),
        explorerUrl: tokenExplorerUrl(slug, address)
      };
    })
    .filter((entry) => entry.network && entry.address);
}

async function fetchPreferredLiquidityByNetwork(supportedNetworks) {
  const evmNetworks = supportedNetworks.filter((entry) =>
    ["ethereum", "base", "arbitrum", "optimism", "polygon", "bnb"].includes(entry.slug)
  );
  return await estimatePreferredRouteLiquidityByNetworks(evmNetworks, {
    prioritiesByNetwork: ONDO_LIQUIDITY_PROVIDER_PRIORITIES
  });
}

async function fetchOndoBirdeyeEnrichment(supportedNetworks) {
  const summaries = [];
  const onchainMarkets = [];

  for (const network of supportedNetworks) {
    if (!["ethereum", "bnb", "solana"].includes(network.slug) || !network.address) {
      continue;
    }

    const [marketData, markets] = await Promise.all([
      fetchBirdeyeTokenMarketData(network.address, network.slug),
      fetchBirdeyeTokenMarkets(network.address, network.slug)
    ]);

    if (!marketData && !markets?.length) {
      continue;
    }

    const marketRows = toBirdeyeMarkets(markets, network.address, network.slug);
    onchainMarkets.push(...marketRows);

    summaries.push({
      network: network.network,
      slug: network.slug,
      address: network.address,
      explorerUrl: network.explorerUrl,
      priceUsd: optionalNumber(marketData?.price),
      liquidityUsd: optionalNumber(marketData?.liquidity),
      holders: optionalNumber(marketData?.holder),
      marketCap: optionalNumber(marketData?.market_cap ?? marketData?.fdv),
      circulatingMarketCap: optionalNumber(marketData?.market_cap),
      totalSupply: optionalNumber(marketData?.total_supply),
      marketCount: marketRows.length || null,
      sources: ["birdeye"]
    });
  }

  return {
    summaries,
    onchainMarkets
  };
}

async function fetchOndoHolderEnrichment(supportedNetworks) {
  const summaries = [];

  for (const network of supportedNetworks) {
    if (!network.slug || !network.address) {
      continue;
    }

    const [coinGeckoInfo, okxTopHolders] = await Promise.all([
      fetchCoinGeckoOnchainTokenInfo(network.address, network.slug).catch(() => null),
      fetchOkxTopTokenHolders(network.address, { network: network.slug, limit: 10 }).catch(() => [])
    ]);

    const holderDistribution = coinGeckoInfo?.holders?.distribution_percentage ?? null;
    const holderCount = optionalNumber(coinGeckoInfo?.holders?.count);
    if (holderCount === null && (!Array.isArray(okxTopHolders) || okxTopHolders.length === 0)) {
      continue;
    }

    summaries.push({
      network: network.network,
      slug: network.slug,
      address: network.address,
      explorerUrl: network.explorerUrl,
      holders: holderCount,
      holderDistribution,
      holdersLastUpdated: coinGeckoInfo?.holders?.last_updated ?? null,
      topHolders: Array.isArray(okxTopHolders) ? okxTopHolders : [],
      sources: [
        ...(holderCount !== null ? ["coingecko"] : []),
        ...(Array.isArray(okxTopHolders) && okxTopHolders.length > 0 ? ["okx"] : [])
      ]
    });
  }

  return summaries;
}

function mergePreferredLiquidity(grouped, rows) {
  for (const row of rows) {
    const key = row.network.network;
    const current = grouped.get(key) ?? {
      network: row.network.network,
      volume24h: null,
      liquidityUsd: null,
      liquidity2Pct: null,
      holders: null,
      marketCap: null,
      circulatingMarketCap: null,
      marketCount: null,
      explorerUrl: row.network.explorerUrl,
      sources: []
    };

    current.liquidity2Pct = row.liquidityUsd;
    current.explorerUrl = current.explorerUrl ?? row.network.explorerUrl;
    current.sources = [...new Set([...(current.sources ?? []), row.provider])];
    grouped.set(key, current);
  }
}

function mergeHolderEnrichment(grouped, rows) {
  for (const row of rows) {
    const key = row.network;
    const current = grouped.get(key) ?? {
      network: row.network,
      volume24h: null,
      liquidityUsd: null,
      liquidity2Pct: null,
      holders: null,
      holderDistribution: null,
      holdersLastUpdated: null,
      topHolders: [],
      marketCap: null,
      circulatingMarketCap: null,
      marketCount: null,
      explorerUrl: row.explorerUrl,
      sources: []
    };

    current.holders = row.holders ?? current.holders;
    current.holderDistribution = row.holderDistribution ?? current.holderDistribution;
    current.holdersLastUpdated = row.holdersLastUpdated ?? current.holdersLastUpdated;
    current.topHolders = row.topHolders?.length ? row.topHolders : current.topHolders;
    current.explorerUrl = current.explorerUrl ?? row.explorerUrl;
    current.sources = [...new Set([...(current.sources ?? []), ...(row.sources ?? [])])];
    grouped.set(key, current);
  }
}

function mergeOndoNetworkBreakdown(birdeyeSummaries = [], holderSummaries = [], preferredLiquidity = []) {
  const grouped = new Map();

  for (const summary of birdeyeSummaries) {
    grouped.set(summary.network, {
      network: summary.network,
      volume24h: null,
      liquidityUsd: summary.liquidityUsd,
      liquidity2Pct: null,
      holders: summary.holders,
      holderDistribution: null,
      holdersLastUpdated: null,
      topHolders: [],
      marketCap: summary.marketCap,
      circulatingMarketCap: summary.circulatingMarketCap,
      marketCount: summary.marketCount,
      explorerUrl: summary.explorerUrl,
      sources: [...new Set(summary.sources ?? [])]
    });
  }

  mergeHolderEnrichment(grouped, holderSummaries);
  mergePreferredLiquidity(grouped, preferredLiquidity);

  return sortNetworkRows([...grouped.values()]);
}

export async function listMarkets() {
  const assets = await fetchOndoAssets();

  return assets
    .map((asset) => {
      const venueTicker = String(asset.symbol ?? "");
      const canonical = canonicalSymbol(venueTicker.replace(/on$/i, ""));
      const name = resolveAssetName(canonical, asset.assetName ?? asset.ticker ?? asset.symbol);

      return {
        venue: "ondo",
        venueTicker,
        symbol: canonical,
        name,
        type: "spot",
        category: inferCategory(canonical, name),
        executionModel: "onchain",
        aliases: resolveAliases(canonical, venueTicker, name),
        supportedNetworks: [],
        raw: asset
      };
    })
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const assets = await fetchOndoAssets();

  const matched = assets
    .map((asset) => {
      const venueTicker = String(asset.symbol ?? "");
      const symbol = canonicalSymbol(venueTicker.replace(/on$/i, ""));
      const name = resolveAssetName(symbol, asset.assetName ?? asset.ticker ?? asset.symbol);

      return {
        venue: "ondo",
        venueTicker,
        symbol,
        name,
        type: "spot",
        executionModel: "onchain",
        price: optionalNumber(asset.primaryMarket?.price),
        bid: null,
        ask: null,
        liquidity2Pct: null,
        volume24h: optionalNumber(asset.primaryMarket?.volume24h),
        openInterest: null,
        fundingRate: null,
        fundingRateApr: null,
        holders: optionalNumber(asset.primaryMarket?.totalHolders),
        totalValue: optionalNumber(asset.primaryMarket?.tvl),
        onchainMarketCap: optionalNumber(asset.primaryMarket?.marketCap),
        circulatingMarketCap: null,
        category: inferCategory(symbol, name),
        supportedNetworks: [],
        networkBreakdown: [],
        raw: asset,
        source: ONDO_APP_ASSETS_URL
      };
    })
    .filter((quote) => wanted.has(quote.symbol))
    .filter((quote) => isTradableRwaSymbol(quote.symbol, quote.name));

  return await Promise.all(
    matched.map(async (quote) => {
      const info = await fetchOndoAssetInfo(quote.venueTicker).catch(() => null);
      const supportedNetworks = mapSupportedNetworks(info?.supportedNetworks ?? []);
      const [
        { summaries: birdeyeSummaries, onchainMarkets },
        holderSummaries,
        preferredLiquidity
      ] = await Promise.all([
        fetchOndoBirdeyeEnrichment(supportedNetworks).catch(() => ({ summaries: [], onchainMarkets: [] })),
        fetchOndoHolderEnrichment(supportedNetworks).catch(() => []),
        fetchPreferredLiquidityByNetwork(supportedNetworks).catch(() => [])
      ]);
      const onchainNetworkBreakdown = mergeOndoNetworkBreakdown(birdeyeSummaries, holderSummaries, preferredLiquidity);
      const topLevelTvl = sumMetric(onchainNetworkBreakdown, "liquidityUsd");
      const topLevelHolders = sumMetric(onchainNetworkBreakdown, "holders");
      const topLevelMarketCap = sumMetric(onchainNetworkBreakdown, "marketCap");
      const topLevelLiquidity2Pct = sumMetric(onchainNetworkBreakdown, "liquidity2Pct");

      return {
        ...quote,
        name: resolveAssetName(quote.symbol, info?.underlyingName ?? info?.tokenName ?? quote.name),
        price: quote.price ?? birdeyeSummaries.find((entry) => entry.priceUsd !== null)?.priceUsd ?? null,
        totalValue: quote.totalValue ?? topLevelTvl,
        holders: quote.holders ?? topLevelHolders,
        onchainMarketCap: quote.onchainMarketCap ?? topLevelMarketCap,
        liquidity2Pct: topLevelLiquidity2Pct,
        onchainMarketCount: onchainMarkets.length || sumMetric(onchainNetworkBreakdown, "marketCount"),
        supportedNetworks,
        onchainNetworkBreakdown,
        onchainMarkets,
        raw: {
          asset: quote.raw,
          info,
          birdeyeSummaries,
          holderSummaries,
          preferredLiquidity
        }
      };
    })
  );
}
