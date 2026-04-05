import { canonicalSymbol, resolveAliases } from "../lib/assets.js";
import { toNumber } from "../lib/http.js";
import { fetchRwaPlatformPage, toRwaNetworkBreakdown, toRwaSupportedNetworks } from "../lib/rwaxyz.js";

function createIssuerAliases(symbol, venueTicker, name, slug, extraAliases = []) {
  return [
    ...resolveAliases(symbol, venueTicker, name),
    slug,
    slug.replace(/-/g, " "),
    ...extraAliases
  ];
}

function createIssuerAdapter(config) {
  async function fetchPlatform() {
    const platform = await fetchRwaPlatformPage(config.platformSlug);

    if (!platform) {
      throw new Error(`Could not load RWA.xyz platform page for ${config.platformSlug}`);
    }

    return platform;
  }

  function toMarket(platform) {
    return {
      venue: config.venue,
      venueTicker: config.venue,
      symbol: canonicalSymbol(config.symbol),
      name: config.name,
      type: "issuer",
      category: "issuer",
      entityKind: "issuer",
      executionModel: "issuer",
      aliases: createIssuerAliases(
        config.symbol,
        config.venue,
        config.name,
        config.platformSlug,
        config.aliases
      ),
      supportedNetworks: toRwaSupportedNetworks(platform.network_stats ?? []),
      networkBreakdown: toRwaNetworkBreakdown(platform.network_stats ?? []),
      raw: platform
    };
  }

  function toQuote(platform) {
    const networkBreakdown = toRwaNetworkBreakdown(platform.network_stats ?? []);

    return {
      venue: config.venue,
      venueTicker: config.venue,
      symbol: canonicalSymbol(config.symbol),
      name: config.name,
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
      holders: toNumber(platform.holding_addresses_count?.val),
      totalValue: toNumber(platform.bridged_token_value_dollar?.val),
      onchainMarketCap: toNumber(platform.bridged_token_market_cap_dollar?.val),
      circulatingMarketCap: toNumber(platform.circulating_asset_value_dollar?.val),
      openInterest: null,
      fundingRate: null,
      fundingRateApr: null,
      supportedNetworks: toRwaSupportedNetworks(platform.network_stats ?? []),
      networkBreakdown,
      onchainNetworkBreakdown: networkBreakdown,
      source: `https://app.rwa.xyz/platforms/${config.platformSlug}`
    };
  }

  return {
    async listMarkets() {
      const platform = await fetchPlatform();
      return [toMarket(platform)];
    },
    async getQuotes(symbols) {
      const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
      if (!wanted.has(canonicalSymbol(config.symbol))) {
        return [];
      }

      const platform = await fetchPlatform();
      return [toQuote(platform)];
    }
  };
}

export const securitize = createIssuerAdapter({
  venue: "securitize",
  platformSlug: "securitize",
  symbol: "SECURITIZE",
  name: "Securitize",
  aliases: ["buidl"]
});

export const dinari = createIssuerAdapter({
  venue: "dinari",
  platformSlug: "dinari",
  symbol: "DINARI",
  name: "Dinari"
});

export const superstate = createIssuerAdapter({
  venue: "superstate",
  platformSlug: "superstate-opening-bell",
  symbol: "SUPERSTATE",
  name: "Superstate Opening Bell",
  aliases: ["opening bell", "superstate opening bell"]
});

export const wisdomtree = createIssuerAdapter({
  venue: "wisdomtree",
  platformSlug: "wisdomtree",
  symbol: "WISDOMTREE",
  name: "WisdomTree"
});

export const stokr = createIssuerAdapter({
  venue: "stokr",
  platformSlug: "stokr",
  symbol: "STOKR",
  name: "STOKR"
});

export const backed = createIssuerAdapter({
  venue: "backed",
  platformSlug: "backed-finance",
  symbol: "BACKED",
  name: "Backed Finance",
  aliases: ["backed finance"]
});

export const remora = createIssuerAdapter({
  venue: "remora",
  platformSlug: "remora-markets",
  symbol: "REMORA",
  name: "Remora Markets",
  aliases: ["remora markets"]
});

export const swarm = createIssuerAdapter({
  venue: "swarm",
  platformSlug: "swarm",
  symbol: "SWARM",
  name: "Swarm"
});
