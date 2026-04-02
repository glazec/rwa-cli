import { fetchJson, toNumber } from "../lib/http.js";
import {
  canonicalSymbol,
  inferCategory,
  isTradableRwaSymbol,
  resolveAliases,
  resolveAssetName
} from "../lib/assets.js";
import { networkDisplayName, tokenExplorerUrl } from "../lib/networks.js";
import { fetchRwaPlatformPage, fetchXstocksProductsPage, toRwaNetworkBreakdown, toRwaSupportedNetworks } from "../lib/rwaxyz.js";

const QUOTE_URL = "https://api.xstocks.fi/api/v1/collateral/quote";

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
      const quote = await fetchQuote(market.venueTicker).catch(() => ({ price: null, timestamp: null }));

      return {
        venue: "xstocks",
        venueTicker: market.venueTicker,
        symbol: market.symbol,
        name: market.name,
        type: "spot",
        category: market.category,
        entityKind: "asset",
        price: quote.price,
        bid: null,
        ask: null,
        liquidity2Pct: null,
        volume24h: null,
        volume30d: null,
        totalValue: null,
        openInterest: null,
        fundingRate: null,
        fundingRateApr: null,
        supportedNetworks: market.supportedNetworks,
        networkBreakdown: [],
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
