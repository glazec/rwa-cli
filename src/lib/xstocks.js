import {
  birdeyeChainForNetwork,
  fetchBirdeyeTokenExitLiquidity,
  fetchBirdeyeTokenMarketData,
  fetchBirdeyeTokenMarkets,
  toBirdeyeMarkets
} from "./birdeye.js";
import { compactList, fetchText, toNumber } from "./http.js";
import { fetchDexScreenerTokenPairs, toDexMarket } from "./dexscreener.js";
import { explorerBaseUrlForNetwork, networkDisplayName, normalizeNetworkKey } from "./networks.js";
import { estimatePreferredRouteLiquidity } from "./route-liquidity.js";
import { estimateStonExitLiquidityUsd, fetchStonTonSummary, STON_USDT_ADDRESS } from "./stonfi.js";

function extractMetric(html, label) {
  const pattern = new RegExp(`####\\s+${label}[\\s\\S]*?\\n\\n([^\\n]+)`, "i");
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function parseCount(value) {
  const match = String(value || "").replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? toNumber(match[1]) : null;
}

function parseCurrency(value) {
  const match = String(value || "").replace(/,/g, "").match(/\$([0-9]+(?:\.[0-9]+)?)/);
  return match ? toNumber(match[1]) : null;
}

export async function fetchEtherscanTokenSummary(address) {
  if (!address) {
    return {
      holders: null,
      onchainMarketCap: null,
      circulatingMarketCap: null,
      decimals: null
    };
  }

  try {
    const html = await fetchText(`https://etherscan.io/token/${address}`, {}, 15000);
    const descriptionMatch = html.match(/content="Token Rep:[^"]*?Onchain Market Cap:\s*\$([0-9.,]+)[^"]*?Holders:\s*([0-9,]+)/i);
    const circulatingMatch = html.match(/Circulating Supply Market Cap[\s\S]{0,200}?\$([0-9.,]+)/i);
    const decimalsMatch = html.match(/WITH\s*<b>\s*([0-9]+)\s*<\/b>\s*Decimals/i);

    return {
      holders: parseCount(descriptionMatch?.[2] ?? extractMetric(html, "Holders")),
      onchainMarketCap: parseCurrency(descriptionMatch?.[1] ? `$${descriptionMatch[1]}` : extractMetric(html, "Onchain Market Cap")),
      circulatingMarketCap: parseCurrency(
        circulatingMatch?.[1] ? `$${circulatingMatch[1]}` : extractMetric(html, "Circulating Supply Market Cap")
      ),
      decimals: parseCount(decimalsMatch?.[1])
    };
  } catch {
    return {
      holders: null,
      onchainMarketCap: null,
      circulatingMarketCap: null,
      decimals: null
    };
  }
}

export async function fetchXstocksOnchainMarkets(addresses = {}) {
  const entries = Object.entries(addresses).filter(([, address]) => Boolean(address));
  const results = await Promise.all(
    entries.map(async ([network, address]) => {
      if (normalizeNetworkKey(network) === "solana") {
        const markets = await fetchBirdeyeTokenMarkets(address, network);
        if (markets.length > 0) {
          return toBirdeyeMarkets(markets, address, network).sort(
            (left, right) => (right.volume24h ?? 0) - (left.volume24h ?? 0)
          );
        }
      }

      const markets = await fetchDexScreenerTokenPairs(network, address);
      const normalizedNetwork = normalizeNetworkKey(network);
      return markets
        .map((pair) => toDexMarket(pair, address))
        .map((market) => ({
          ...market,
          network: networkDisplayName(normalizedNetwork)
        }))
        .filter((market) => market.pairAddress)
        .sort((left, right) => (right.volume24h ?? 0) - (left.volume24h ?? 0));
    })
  );

  return results.flat();
}

export async function fetchXstocksBirdeyeNetworkSummaries(addresses = {}) {
  const entries = Object.entries(addresses).filter(([, address]) => Boolean(address));
  const summaries = [];

  for (const [network, address] of entries) {
    if (!birdeyeChainForNetwork(network)) {
      if (normalizeNetworkKey(network) !== "ton") {
        continue;
      }
    }

    const normalizedNetwork = normalizeNetworkKey(network);
    const stonSummaryPromise =
      normalizedNetwork === "ton" ? fetchStonTonSummary(address).catch(() => null) : Promise.resolve(null);
    const [marketData, exitLiquidity, jupiterLiquidity, stonSummary, stonLiquidity] = await Promise.all([
      fetchBirdeyeTokenMarketData(address, network),
      fetchBirdeyeTokenExitLiquidity(address, network),
      normalizedNetwork === "solana"
        ? estimatePreferredRouteLiquidity(address, {
            network: "solana",
            providers: ["jupiter_quote"]
          }).catch(() => null)
        : Promise.resolve(null),
      stonSummaryPromise,
      normalizedNetwork === "ton"
        ? stonSummaryPromise
            .then((summary) =>
              summary?.decimals
                ? estimateStonExitLiquidityUsd(address, {
                    decimals: summary.decimals,
                    askAddress: summary.askAsset?.address ?? STON_USDT_ADDRESS
                  })
                : null
            )
            .catch(() => null)
        : Promise.resolve(null)
    ]);

    if (!marketData && !exitLiquidity && !jupiterLiquidity && !stonSummary && !stonLiquidity) {
      continue;
    }

    summaries.push({
      network: networkDisplayName(network),
      slug: normalizeNetworkKey(network),
      explorerUrl: explorerBaseUrlForNetwork(network),
      address,
      priceUsd: toNumber(marketData?.price ?? stonSummary?.priceUsd),
      liquidityUsd: toNumber(marketData?.liquidity ?? exitLiquidity?.liquidity ?? stonSummary?.liquidityUsd),
      liquidity2Pct: toNumber(exitLiquidity?.exit_liquidity ?? jupiterLiquidity?.liquidityUsd ?? stonLiquidity?.liquidityUsd),
      holders: toNumber(marketData?.holder),
      marketCap: toNumber(marketData?.market_cap ?? marketData?.fdv),
      circulatingMarketCap: toNumber(marketData?.market_cap),
      totalSupply: toNumber(marketData?.total_supply),
      circulatingSupply: toNumber(marketData?.circulating_supply),
      marketCount: stonSummary?.marketCount ?? null,
      sources: compactList([
        marketData ? "birdeye" : null,
        exitLiquidity?.exit_liquidity ? "birdeye_exit_liquidity" : null,
        jupiterLiquidity?.liquidityUsd ? "jupiter_quote" : null,
        stonSummary ? "stonfi" : null,
        stonLiquidity?.liquidityUsd ? "stonfi_quote" : null
      ])
    });
  }

  return summaries;
}

export function summarizeBirdeyeNetworkSummaries(summaries = []) {
  return {
    priceUsd: summaries.find((entry) => entry.priceUsd !== null)?.priceUsd ?? null,
    holders: summaries.reduce((sum, entry) => sum + (entry.holders ?? 0), 0) || null,
    marketCap: summaries.reduce((sum, entry) => sum + (entry.marketCap ?? 0), 0) || null,
    circulatingMarketCap: summaries.reduce((sum, entry) => sum + (entry.circulatingMarketCap ?? 0), 0) || null,
    liquidityUsd: summaries.reduce((sum, entry) => sum + (entry.liquidityUsd ?? 0), 0) || null,
    liquidity2Pct: summaries.reduce((sum, entry) => sum + (entry.liquidity2Pct ?? 0), 0) || null
  };
}

export function mergeXstocksNetworkBreakdown(markets = [], summaries = []) {
  const grouped = new Map();

  for (const entry of summarizeXstocksOnchainMarkets(markets)) {
    grouped.set(entry.network, {
      ...entry,
      holders: null,
      liquidity2Pct: null,
      circulatingMarketCap: null,
      sources: ["markets"]
    });
  }

  for (const summary of summaries) {
    const current = grouped.get(summary.network) ?? {
      network: summary.network,
      volume24h: 0,
      liquidityUsd: 0,
      liquidity2Pct: null,
      holders: null,
      marketCap: null,
      circulatingMarketCap: null,
      marketCount: 0,
      explorerUrl: summary.explorerUrl,
      sources: []
    };

    current.explorerUrl = current.explorerUrl ?? summary.explorerUrl;
    current.liquidityUsd = Math.max(current.liquidityUsd ?? 0, summary.liquidityUsd ?? 0) || current.liquidityUsd;
    current.liquidity2Pct = summary.liquidity2Pct ?? current.liquidity2Pct;
    current.holders = summary.holders ?? current.holders;
    current.marketCap = summary.marketCap ?? current.marketCap;
    current.circulatingMarketCap = summary.circulatingMarketCap ?? current.circulatingMarketCap;
    current.marketCount = Math.max(current.marketCount ?? 0, summary.marketCount ?? 0);
    current.sources = [...new Set([...(current.sources ?? []), ...(summary.sources ?? [])])];
    grouped.set(summary.network, current);
  }

  return [...grouped.values()].sort((left, right) => (right.volume24h ?? 0) - (left.volume24h ?? 0));
}

export function summarizeXstocksOnchainMarkets(markets = []) {
  const grouped = new Map();

  for (const market of markets) {
    const key = market.network;
    const current = grouped.get(key) ?? {
      network: market.network,
      volume24h: 0,
      liquidityUsd: 0,
      marketCap: null,
      marketCount: 0
    };

    current.volume24h += market.volume24h ?? 0;
    current.liquidityUsd += market.liquidityUsd ?? 0;
    current.marketCount += 1;
    current.marketCap = Math.max(current.marketCap ?? 0, market.marketCap ?? 0) || current.marketCap;
    grouped.set(key, current);
  }

  return [...grouped.values()].sort((left, right) => (right.volume24h ?? 0) - (left.volume24h ?? 0));
}
