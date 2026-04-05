import {
  canonicalSymbol,
  inferCategory,
  isTradableRwaSymbol,
  resolveAliases,
  resolveAssetName
} from "../lib/assets.js";
import { fetchDexScreenerTokenPairs, toDexMarket } from "../lib/dexscreener.js";
import { networkDisplayName, tokenExplorerUrl } from "../lib/networks.js";
import { maxMetric, sumMetric } from "../lib/onchain-data.js";
import { estimatePreferredRouteLiquidity } from "../lib/route-liquidity.js";
import { fetchXstocksProductsPage } from "../lib/rwaxyz.js";

function canonicalProductSymbol(productSymbol) {
  return canonicalSymbol(String(productSymbol || "").replace(/x$/i, ""));
}

function stripXstocksSuffix(name) {
  return String(name || "")
    .replace(/\s+xStock$/i, "")
    .trim();
}

function toSolanaSupportedNetwork(address) {
  return address
    ? [
        {
          network: "Solana",
          slug: "solana",
          address,
          explorerUrl: tokenExplorerUrl("solana", address)
        }
      ]
    : [];
}

function toMarket(product) {
  const symbol = canonicalProductSymbol(product.symbol);
  const name = resolveAssetName(symbol, stripXstocksSuffix(product.name));
  const solanaAddress = product?.addresses?.solana ?? null;

  return {
    venue: "raydium",
    venueTicker: product.symbol,
    symbol,
    name,
    type: "spot",
    category: inferCategory(symbol, name),
    entityKind: "asset",
    executionModel: "onchain",
    aliases: resolveAliases(symbol, product.symbol, name),
    supportedNetworks: toSolanaSupportedNetwork(solanaAddress),
    networkBreakdown: [],
    raw: product
  };
}

async function fetchProducts() {
  const products = await fetchXstocksProductsPage();
  return products.filter((product) => Boolean(product?.addresses?.solana));
}

async function fetchRaydiumMarkets(solanaAddress) {
  const pairs = await fetchDexScreenerTokenPairs("solana", solanaAddress);
  return pairs
    .map((pair) => toDexMarket(pair, solanaAddress))
    .map((market) => ({
      ...market,
      network: networkDisplayName("solana")
    }))
    .filter((market) => market.dex === "raydium" && market.pairAddress)
    .sort((left, right) => (right.volume24h ?? 0) - (left.volume24h ?? 0));
}

export async function listMarkets() {
  const products = await fetchProducts();
  return products
    .map((product) => toMarket(product))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const products = await fetchProducts();

  const matched = products
    .map((product) => toMarket(product))
    .filter((market) => wanted.has(market.symbol))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));

  return await Promise.all(
    matched.map(async (market) => {
      const solanaAddress = market.supportedNetworks[0]?.address ?? null;
      const [raydiumMarkets, slippageEstimate] = await Promise.all([
        fetchRaydiumMarkets(solanaAddress).catch(() => []),
        estimatePreferredRouteLiquidity(solanaAddress, {
          network: "solana",
          providers: ["jupiter_quote"]
        }).catch(() => null)
      ]);

      const [primary] = raydiumMarkets;
      const totalValue = sumMetric(raydiumMarkets, "liquidityUsd");
      const volume24h = sumMetric(raydiumMarkets, "volume24h");
      const onchainMarketCap = maxMetric(raydiumMarkets, "marketCap");
      const liquidity2Pct = slippageEstimate?.liquidityUsd ?? null;

      return {
        venue: "raydium",
        venueTicker: market.venueTicker,
        symbol: market.symbol,
        name: market.name,
        type: "spot",
        category: market.category,
        entityKind: "asset",
        executionModel: "onchain",
        price: primary?.priceUsd ?? null,
        bid: null,
        ask: null,
        liquidity2Pct,
        volume24h,
        volume30d: null,
        totalValue,
        openInterest: null,
        fundingRate: null,
        fundingRateApr: null,
        holders: null,
        onchainMarketCap,
        circulatingMarketCap: null,
        onchainMarketCount: raydiumMarkets.length || null,
        supportedNetworks: market.supportedNetworks,
        networkBreakdown: [],
        onchainNetworkBreakdown: [
          {
            network: "Solana",
            volume24h,
            liquidityUsd: totalValue,
            liquidity2Pct,
            holders: null,
            marketCap: onchainMarketCap,
            circulatingMarketCap: null,
            marketCount: raydiumMarkets.length,
            explorerUrl: tokenExplorerUrl("solana"),
            sources: ["dexscreener", "jupiter_quote"]
          }
        ],
        onchainMarkets: raydiumMarkets,
        source: `https://xstocks.fi/us/products + https://api.dexscreener.com/token-pairs/v1/solana/${solanaAddress}`
      };
    })
  );
}
