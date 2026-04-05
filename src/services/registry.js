import * as binance from "../venues/binance.js";
import * as bingx from "../venues/bingx.js";
import * as bitget from "../venues/bitget.js";
import * as bitmart from "../venues/bitmart.js";
import * as bybit from "../venues/bybit.js";
import * as coingecko from "../venues/coingecko.js";
import * as gate from "../venues/gate.js";
import { backed, dinari, securitize, stokr, superstate, swarm, wisdomtree } from "../venues/issuers.js";
import * as lbank from "../venues/lbank.js";
import * as lighter from "../venues/lighter.js";
import * as mexc from "../venues/mexc.js";
import * as ondo from "../venues/ondo.js";
import * as ourbit from "../venues/ourbit.js";
import * as raydium from "../venues/raydium.js";
import * as remora from "../venues/remora.js";
import { priceDeviationPct } from "../lib/market.js";
import { getReferencePrices } from "./reference.js";
import * as stablestock from "../venues/stablestock.js";
import * as tradexyz from "../venues/tradexyz.js";
import * as vest from "../venues/vest.js";
import * as xt from "../venues/xt.js";
import * as xstocks from "../venues/xstocks.js";

export const VENUES = new Map([
  ["backed", backed],
  ["binance", binance],
  ["bingx", bingx],
  ["bitget", bitget],
  ["bitmart", bitmart],
  ["bybit", bybit],
  ["coingecko", coingecko],
  ["dinari", dinari],
  ["gate", gate],
  ["lbank", lbank],
  ["lighter", lighter],
  ["mexc", mexc],
  ["ondo", ondo],
  ["ourbit", ourbit],
  ["raydium", raydium],
  ["remora", remora],
  ["securitize", securitize],
  ["stablestock", stablestock],
  ["stokr", stokr],
  ["superstate", superstate],
  ["swarm", swarm],
  ["trade.xyz", tradexyz],
  ["vest", vest],
  ["wisdomtree", wisdomtree],
  ["xt", xt],
  ["xstocks", xstocks]
]);

function normalizeEntity(record, venue) {
  return {
    venue,
    entityKind: record.entityKind ?? "asset",
    executionModel: record.executionModel ?? null,
    supportedNetworks: record.supportedNetworks ?? [],
    networkBreakdown: record.networkBreakdown ?? [],
    holders: record.holders ?? null,
    volume30d: record.volume30d ?? null,
    totalValue: record.totalValue ?? null,
    onchainMarketCap: record.onchainMarketCap ?? null,
    circulatingMarketCap: record.circulatingMarketCap ?? null,
    onchainMarketCount: record.onchainMarketCount ?? null,
    onchainNetworkBreakdown: record.onchainNetworkBreakdown ?? [],
    onchainMarkets: record.onchainMarkets ?? [],
    ...record
  };
}

export function resolveVenue(name) {
  if (!name) {
    return null;
  }

  const normalized = name.toLowerCase();
  if (normalized === "trade" || normalized === "tradexyz") {
    return "trade.xyz";
  }
  if (normalized === "stable" || normalized === "stable-stock") {
    return "stablestock";
  }
  if (normalized === "vest.xyz" || normalized === "vestmarkets") {
    return "vest";
  }
  if (normalized === "xstock" || normalized === "x-stocks") {
    return "xstocks";
  }
  if (normalized === "xt.com" || normalized === "xtcom") {
    return "xt";
  }
  if (normalized === "backed-finance") {
    return "backed";
  }
  if (normalized === "bing-x") {
    return "bingx";
  }
  if (normalized === "bit-mart") {
    return "bitmart";
  }
  if (normalized === "cg" || normalized === "gecko") {
    return "coingecko";
  }
  if (normalized === "lbk") {
    return "lbank";
  }
  if (normalized === "our-bit") {
    return "ourbit";
  }
  if (normalized === "ray" || normalized === "raydiumio") {
    return "raydium";
  }
  if (normalized === "remora-markets") {
    return "remora";
  }
  if (normalized === "superstate-opening-bell" || normalized === "opening-bell") {
    return "superstate";
  }

  return VENUES.has(normalized) ? normalized : null;
}

export async function listAllMarkets(venueFilter = null) {
  const venues = [...VENUES.entries()].filter(([venue]) => !venueFilter || venue === venueFilter);
  const results = await Promise.allSettled(
    venues.map(async ([venue, adapter]) => {
      const markets = await adapter.listMarkets();
      return markets.map((market) => normalizeEntity(market, venue));
    })
  );

  const fulfilled = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);

  if (fulfilled.length > 0) {
    return fulfilled;
  }

  const [firstError] = results.filter((result) => result.status === "rejected");
  throw firstError?.reason ?? new Error("No venue data available");
}

export async function getQuotesForSymbols(symbols, venueFilter = null) {
  const venues = [...VENUES.entries()].filter(([venue]) => !venueFilter || venue === venueFilter);
  const results = await Promise.allSettled(
    venues.map(async ([venue, adapter]) => {
      const quotes = await adapter.getQuotes(symbols);
      return quotes.map((quote) => normalizeEntity(quote, venue));
    })
  );

  const quotes = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);
  if (quotes.length === 0) {
    return [];
  }

  const referencePrices = await getReferencePrices(
    quotes.filter((quote) => quote.entityKind === "asset").map((quote) => quote.symbol)
  );

  return quotes.map((quote) => {
    const referencePrice = quote.entityKind === "asset" ? referencePrices.get(quote.symbol) ?? null : null;

    return {
      ...quote,
      referencePrice,
      priceDeviationPct: priceDeviationPct(quote.price, referencePrice)
    };
  });
}
