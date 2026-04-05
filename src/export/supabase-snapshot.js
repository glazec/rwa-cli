// src/export/supabase-snapshot.js

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { aggregateAssets } from "../services/query.js";
import { getQuotesForSymbols, listAllMarkets } from "../services/registry.js";
import { VENUE_META } from "./venue-meta.js";
import { normalizeAssetClass, normalizeEntityKind, normalizeMarketType } from "./normalize.js";

const SCHEMA_VERSION = 1;

function readCliVersion() {
  try {
    const pkgPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../package.json"
    );
    return JSON.parse(readFileSync(pkgPath, "utf8")).version;
  } catch {
    return "unknown";
  }
}

function buildVenueRow(venueSlug) {
  const meta = VENUE_META.get(venueSlug) ?? { venueType: "hybrid", tierLabel: "Unknown" };
  return {
    slug: venueSlug,
    name: venueSlug,
    venue_type: meta.venueType,
    tier_label: meta.tierLabel,
  };
}

function buildEntityRow(aggregated) {
  const entityKind = normalizeEntityKind(
    aggregated.entityKinds.includes("issuer") ? "issuer" :
    aggregated.entityKinds.includes("platform") ? "platform" : "asset"
  );

  return {
    symbol: aggregated.symbol,
    name: aggregated.name,
    entity_kind: entityKind,
    asset_class: normalizeAssetClass(aggregated.category),
    networks: aggregated.networks,
  };
}

function buildVenueEntityRow(quote) {
  return {
    venue_slug: quote.venue,
    entity_symbol: quote.symbol,
    ticker: quote.venueTicker,
    market_type: normalizeMarketType(quote.type),
    is_active: true,
  };
}

function buildMarketDataRow(quote) {
  return {
    venue_slug: quote.venue,
    entity_symbol: quote.symbol,
    market_type: normalizeMarketType(quote.type),
    price: quote.price ?? null,
    reference_price: quote.referencePrice ?? null,
    price_deviation_pct: quote.priceDeviationPct ?? null,
    bid: quote.bid ?? null,
    ask: quote.ask ?? null,
    volume_24h: quote.volume24h ?? null,
    volume_30d: quote.volume30d ?? null,
    open_interest: quote.openInterest ?? null,
    funding_rate_raw: quote.fundingRate ?? null,
    funding_rate_apy: quote.fundingRateApr ?? null,
    liquidity_2pct_usd: quote.liquidity2Pct ?? null,
    liquidity_depth_usd: null,
    holders: quote.holders ?? null,
    total_value_usd: quote.totalValue ?? null,
    onchain_market_cap: quote.onchainMarketCap ?? null,
    circulating_market_cap: quote.circulatingMarketCap ?? null,
    onchain_market_count: quote.onchainMarketCount ?? null,
    execution_model: quote.executionModel ?? null,
    raw_quote: quote,
    field_scopes: quote.fieldScopes ?? null,
    field_sources: quote.fieldSources ?? null,
    source: quote.source ?? null,
  };
}

function buildNetworkBreakdownRows(quote) {
  return (quote.onchainNetworkBreakdown ?? []).map((row) => ({
    venue_slug: quote.venue,
    entity_symbol: quote.symbol,
    market_type: normalizeMarketType(quote.type),
    network: row.network,
    liquidity_usd: row.liquidityUsd ?? null,
    liquidity_2pct_usd: row.liquidity2Pct ?? null,
    holders: row.holders ?? null,
    market_cap: row.marketCap ?? null,
    circulating_market_cap: row.circulatingMarketCap ?? null,
    market_count: row.marketCount ?? null,
    volume_24h: row.volume24h ?? null,
    explorer_url: row.explorerUrl ?? null,
    sources: row.sources ?? [],
  }));
}

function buildOnchainMarketRows(quote) {
  return (quote.onchainMarkets ?? []).map((row) => ({
    venue_slug: quote.venue,
    entity_symbol: quote.symbol,
    market_type: normalizeMarketType(quote.type),
    dex: row.dex ?? null,
    network: row.network ?? null,
    pair: row.pair ?? null,
    price: row.price ?? null,
    volume_24h: row.volume24h ?? null,
    liquidity_usd: row.liquidityUsd ?? null,
    liquidity_2pct_usd: row.liquidity2Pct ?? null,
    url: row.url ?? null,
    source: row.source ?? null,
  }));
}

function buildSupportedNetworkRows(quote) {
  return (quote.supportedNetworks ?? []).map((row) => ({
    venue_slug: quote.venue,
    entity_symbol: quote.symbol,
    network: row.network,
    contract_address: row.contractAddress ?? null,
    explorer_url: row.explorerUrl ?? null,
  }));
}

export async function buildSupabaseSnapshot() {
  const markets = await listAllMarkets();
  const assets = aggregateAssets(markets);

  const allSymbols = assets.map((a) => a.symbol);
  const quotes = await getQuotesForSymbols(allSymbols);

  const venueSet = new Set();
  for (const quote of quotes) venueSet.add(quote.venue);
  for (const market of markets) venueSet.add(market.venue);

  const venues = [...venueSet].sort().map(buildVenueRow);
  const entities = assets.map(buildEntityRow);

  const venueEntityKeys = new Set();
  const venueEntities = [];
  const marketDataCurrent = [];
  const networkBreakdown = [];
  const onchainMarkets = [];
  const supportedNetworks = [];

  for (const quote of quotes) {
    const veKey = `${quote.venue}:${quote.symbol}:${normalizeMarketType(quote.type)}`;
    if (!venueEntityKeys.has(veKey)) {
      venueEntityKeys.add(veKey);
      venueEntities.push(buildVenueEntityRow(quote));
    }

    marketDataCurrent.push(buildMarketDataRow(quote));
    networkBreakdown.push(...buildNetworkBreakdownRows(quote));
    onchainMarkets.push(...buildOnchainMarketRows(quote));
    supportedNetworks.push(...buildSupportedNetworkRows(quote));
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    cliVersion: readCliVersion(),
    generatedAt: new Date().toISOString(),
    venues,
    entities,
    venueEntities,
    marketDataCurrent,
    networkBreakdownCurrent: networkBreakdown,
    onchainMarketsCurrent: onchainMarkets,
    supportedNetworks,
    summary: {
      venueCount: venues.length,
      entityCount: entities.length,
      venueEntityCount: venueEntities.length,
      quoteCount: marketDataCurrent.length,
      networkBreakdownCount: networkBreakdown.length,
      onchainMarketCount: onchainMarkets.length,
    },
  };
}
