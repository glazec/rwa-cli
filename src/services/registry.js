import * as binance from "../venues/binance.js";
import * as bitget from "../venues/bitget.js";
import * as coingecko from "../venues/coingecko.js";
import * as gate from "../venues/gate.js";
import { backed, dinari, remora, securitize, stokr, superstate, swarm, wisdomtree } from "../venues/issuers.js";
import * as lighter from "../venues/lighter.js";
import * as mexc from "../venues/mexc.js";
import * as ondo from "../venues/ondo.js";
import { priceDeviationPct } from "../lib/market.js";
import { getReferencePrices } from "./reference.js";
import * as stablestock from "../venues/stablestock.js";
import * as tradexyz from "../venues/tradexyz.js";
import * as vest from "../venues/vest.js";
import * as xstocks from "../venues/xstocks.js";

export const VENUES = new Map([
  ["backed", backed],
  ["binance", binance],
  ["bitget", bitget],
  ["coingecko", coingecko],
  ["dinari", dinari],
  ["gate", gate],
  ["lighter", lighter],
  ["mexc", mexc],
  ["ondo", ondo],
  ["remora", remora],
  ["securitize", securitize],
  ["stablestock", stablestock],
  ["stokr", stokr],
  ["superstate", superstate],
  ["swarm", swarm],
  ["trade.xyz", tradexyz],
  ["vest", vest],
  ["wisdomtree", wisdomtree],
  ["xstocks", xstocks]
]);

function normalizeEntity(record, venue) {
  return {
    venue,
    entityKind: record.entityKind ?? "asset",
    supportedNetworks: record.supportedNetworks ?? [],
    networkBreakdown: record.networkBreakdown ?? [],
    volume30d: record.volume30d ?? null,
    totalValue: record.totalValue ?? null,
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
  if (normalized === "backed-finance") {
    return "backed";
  }
  if (normalized === "cg" || normalized === "gecko") {
    return "coingecko";
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
