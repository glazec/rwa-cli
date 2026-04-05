#!/usr/bin/env node

import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
  formatSignedPercent,
  printTable
} from "./lib/format.js";
import { cacheSettings, clearCache, setCacheBypass } from "./lib/cache.js";
import {
  getConfigPath,
  hasSetting,
  listSettings,
  setSetting,
  unsetSetting
} from "./lib/config.js";
import { fetchOndoAssets } from "./lib/ondo-app.js";
import {
  aggregateAssets,
  findExactMatchingAssets,
  findMatchingAssets
} from "./services/query.js";
import { buildDiscoverySnapshot, discoverAssets } from "./services/discovery.js";
import { getQuotesForSymbols, listAllMarkets, resolveVenue, VENUES } from "./services/registry.js";

const program = new Command();

class CliError extends Error {
  constructor(code, message, details = {}, exitCode = 1) {
    super(message);
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

function getOutputOptions(commandOptions = {}) {
  const globalOptions = program.opts();
  return {
    json: Boolean(commandOptions.json || globalOptions.json),
    agent: Boolean(commandOptions.agent || globalOptions.agent)
  };
}

function emitSuccess(command, data, commandOptions, render, meta = {}) {
  const output = getOutputOptions(commandOptions);

  if (output.agent) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          command,
          generatedAt: new Date().toISOString(),
          ...meta,
          data
        },
        null,
        2
      )
    );
    return;
  }

  if (output.json) {
    console.log(JSON.stringify({ ...data, advisories: meta.advisories ?? [] }, null, 2));
    return;
  }

  render(data);

  if ((meta.advisories ?? []).length > 0) {
    console.log("");
    console.log("notes");
    for (const advisory of meta.advisories) {
      console.log(`- ${advisory}`);
    }
  }
}

function fail(code, message, details = {}, exitCode = 1) {
  throw new CliError(code, message, details, exitCode);
}

function normalizeVenueOption(option) {
  if (!option) {
    return null;
  }

  const venue = resolveVenue(option);
  if (!venue) {
    fail(
      "UNKNOWN_VENUE",
      `Unknown venue "${option}". Valid venues: ${[...VENUES.keys()].join(", ")}`,
      {
        venue: option,
        validVenues: [...VENUES.keys()]
      },
      2
    );
  }

  return venue;
}

function resolveMatches(assets, query, exact = false) {
  return exact ? findExactMatchingAssets(assets, query) : findMatchingAssets(assets, query);
}

function renderAssetTable(rows) {
  printTable(rows, [
    { label: "SYMBOL", value: (row) => row.symbol },
    { label: "NAME", value: (row) => row.name, maxWidth: 36 },
    { label: "ENTITY", value: (row) => row.entityKinds.join(",") },
    { label: "CATEGORY", value: (row) => row.category },
    { label: "VENUES", value: (row) => row.venues.join(",") },
    { label: "TYPES", value: (row) => row.marketTypes.join(",") },
    { label: "NETWORKS", value: (row) => row.networks.join(","), maxWidth: 28 }
  ]);
}

function renderNetworkBreakdown(quote) {
  if (!quote.networkBreakdown?.length) {
    return;
  }

  console.log("");
  console.log(`${quote.venue} network breakdown`);
  printTable(quote.networkBreakdown, [
    { label: "NETWORK", value: (row) => row.network, maxWidth: 24 },
    { label: "VOL 30D", value: (row) => formatCompactCurrency(row.volume30d) },
    { label: "TVL", value: (row) => formatCompactCurrency(row.totalValue) },
    { label: "HOLDERS", value: (row) => row.holders ?? "-" },
    { label: "ACTIVE 30D", value: (row) => row.activeAddresses30d ?? "-" }
  ]);
}

function renderExplorerLinks(quote) {
  const links = (quote.supportedNetworks ?? []).filter((network) => network.explorerUrl);
  if (links.length === 0) {
    return;
  }

  console.log("");
  console.log(`${quote.venue} networks`);
  for (const network of links) {
    const parts = [network.network];
    if (network.address) {
      parts.push(network.address);
    }
    parts.push(network.explorerUrl);
    console.log(`- ${parts.join("  ")}`);
  }
}

function renderOnchainNetworkBreakdown(quote) {
  if (!quote.onchainNetworkBreakdown?.length) {
    return;
  }

  console.log("");
  console.log(`${quote.venue} onchain networks`);
  printTable(quote.onchainNetworkBreakdown, [
    { label: "NETWORK", value: (row) => row.network, maxWidth: 20 },
    { label: "MKTS", value: (row) => row.marketCount ?? "-" },
    { label: "VOL 24H", value: (row) => formatCompactCurrency(row.volume24h) },
    { label: "TVL", value: (row) => formatCompactCurrency(row.liquidityUsd) },
    { label: "+/-2% LIQ", value: (row) => formatCompactCurrency(row.liquidity2Pct) },
    { label: "HOLDERS", value: (row) => row.holders ?? "-" },
    { label: "MKT CAP", value: (row) => formatCompactCurrency(row.marketCap) }
  ]);
}

function renderOnchainMarkets(quote) {
  if (!quote.onchainMarkets?.length) {
    return;
  }

  console.log("");
  console.log(`${quote.venue} onchain markets`);
  printTable(quote.onchainMarkets.slice(0, 20), [
    { label: "NETWORK", value: (row) => row.network, maxWidth: 16 },
    { label: "DEX", value: (row) => row.dex, maxWidth: 18 },
    { label: "PAIR", value: (row) => row.pairLabel, maxWidth: 18 },
    { label: "PRICE", value: (row) => formatCurrency(row.priceUsd, 4) },
    { label: "VOL 24H", value: (row) => formatCompactCurrency(row.volume24h) },
    { label: "TVL", value: (row) => formatCompactCurrency(row.liquidityUsd) },
    { label: "+/-2% LIQ", value: (row) => formatCompactCurrency(row.liquidity2Pct) },
    { label: "MKT CAP", value: (row) => formatCompactCurrency(row.marketCap) }
  ]);
}

function sumMetric(items, field) {
  const total = (items ?? []).reduce((sum, item) => sum + (item?.[field] ?? 0), 0);
  return total || null;
}

function quoteTvl(quote) {
  return quote.totalValue ?? sumMetric(quote.onchainMarkets, "liquidityUsd");
}

function quoteLiquidity2Pct(quote) {
  return quote.liquidity2Pct ?? sumMetric(quote.onchainMarkets, "liquidity2Pct");
}

function quoteVolume(quote) {
  return quote.volume24h ?? quote.volume30d;
}

function quoteOnchainMarketCount(quote) {
  return quote.onchainMarketCount ?? (quote.onchainMarkets?.length || null);
}

function hasOkxCredentials() {
  return hasSetting("OKX_API_KEY") && hasSetting("OKX_SECRET_KEY") && hasSetting("OKX_API_PASSPHRASE");
}

function quoteAdvisories(quotes = []) {
  const venues = new Set(quotes.map((quote) => quote.venue));
  const advisories = [];

  if (
    ["ondo", "xstocks", "remora"].some((venue) => venues.has(venue)) &&
    !hasSetting("BIRDEYE_API_KEY") &&
    !hasSetting("UNIBLOCK_API_KEY")
  ) {
    advisories.push("Set UNIBLOCK_API_KEY or BIRDEYE_API_KEY to widen Birdeye market coverage.");
  }

  if (venues.has("ondo") && !hasSetting("COINGECKO_API_KEY", ["COINGECKO_PRO_API_KEY"])) {
    advisories.push("Set COINGECKO_API_KEY to enrich Ondo holder counts and holder distribution.");
  }

  if (venues.has("ondo") && !hasSetting("ONEINCH_API_KEY")) {
    advisories.push("Set ONEINCH_API_KEY to widen Ondo route-based +/-2% liquidity coverage.");
  }

  if (venues.has("ondo") && !hasOkxCredentials()) {
    advisories.push("Set OKX_API_KEY, OKX_SECRET_KEY, and OKX_API_PASSPHRASE to enable OKX wallet quotes and top-holder enrichment.");
  }

  return advisories;
}

function discoveryAdvisories() {
  const advisories = [];

  if (!hasSetting("UNIBLOCK_API_KEY")) {
    advisories.push("Set UNIBLOCK_API_KEY to widen discovery with CoinMarketCap categories and Birdeye-through-Uniblock.");
  }

  if (!hasSetting("COINGECKO_API_KEY", ["COINGECKO_PRO_API_KEY"])) {
    advisories.push("Set COINGECKO_API_KEY for fuller CoinGecko onchain enrichment and holder coverage.");
  }

  return advisories;
}

function isIssuerOrOnchainQuote(quote) {
  return (
    quote.entityKind === "issuer" ||
    quote.executionModel === "issuer" ||
    quote.executionModel === "onchain" ||
    (quote.onchainMarkets?.length ?? 0) > 0 ||
    (quote.onchainNetworkBreakdown?.length ?? 0) > 0
  );
}

function renderDiscovery(payload) {
  if (payload.cmc.matches.length > 0) {
    console.log("CMC assets");
    printTable(payload.cmc.matches, [
      { label: "SYMBOL", value: (row) => row.symbol },
      { label: "NAME", value: (row) => row.name, maxWidth: 34 },
      { label: "TYPE", value: (row) => row.type },
      { label: "SLUG", value: (row) => row.slug, maxWidth: 24 },
      { label: "RANK", value: (row) => row.rank ?? "-" }
    ]);
  }

  if (payload.cmc.selected) {
    if (payload.cmc.tokens.length > 0) {
      console.log("");
      console.log(`CMC tokenized assets for ${payload.cmc.selected.slug}`);
      printTable(payload.cmc.tokens, [
        { label: "SYMBOL", value: (row) => row.symbol },
        { label: "NAME", value: (row) => row.name, maxWidth: 32 },
        { label: "ISSUER", value: (row) => row.issuer, maxWidth: 20 },
        { label: "PRICE", value: (row) => formatCurrency(row.price, 4) },
        { label: "VOL 24H", value: (row) => formatCompactCurrency(row.volume24h) }
      ]);
    }

    if (payload.cmc.marketPairs.length > 0) {
      console.log("");
      console.log(`CMC venue pairs for ${payload.cmc.selected.slug}`);
      printTable(payload.cmc.marketPairs, [
        { label: "EXCHANGE", value: (row) => row.exchange, maxWidth: 20 },
        { label: "PAIR", value: (row) => row.marketPair, maxWidth: 22 },
        { label: "PRICE", value: (row) => formatCurrency(row.price, 4) },
        { label: "VOL 24H", value: (row) => formatCompactCurrency(row.volume24h) },
        { label: "-2% LIQ", value: (row) => formatCompactCurrency(row.liquidityNeg2Pct) },
        { label: "+2% LIQ", value: (row) => formatCompactCurrency(row.liquidityPos2Pct) }
      ]);
    }
  }

  if (payload.cmcCategories?.matches?.length > 0) {
    console.log(
      payload.cmc.matches.length > 0 || payload.cmc.selected ? "\nCMC tokenized categories" : "CMC tokenized categories"
    );
    printTable(payload.cmcCategories.matches, [
      { label: "SYMBOL", value: (row) => row.symbol },
      { label: "NAME", value: (row) => row.name, maxWidth: 30 },
      { label: "CATEGORY", value: (row) => row.category, maxWidth: 22 },
      { label: "PRICE", value: (row) => formatCurrency(row.price, 4) },
      { label: "VOL 24H", value: (row) => formatCompactCurrency(row.volume24h) },
      { label: "MKT CAP", value: (row) => formatCompactCurrency(row.marketCap) }
    ]);
  }

  if (payload.dinari?.matches?.length > 0) {
    console.log(
      payload.cmc.matches.length > 0 ||
        payload.cmc.selected ||
        payload.cmcCategories?.matches?.length > 0 ||
        payload.coingecko.matches.length > 0
        ? "\nDinari dShares"
        : "Dinari dShares"
    );
    printTable(payload.dinari.matches, [
      { label: "SYMBOL", value: (row) => row.symbol },
      { label: "DSHARE", value: (row) => row.venueTicker },
      { label: "NAME", value: (row) => row.name, maxWidth: 34 }
    ]);

    if (payload.dinari.tokens?.length > 0) {
      console.log("\nDinari wrappers on CMC");
      printTable(payload.dinari.tokens, [
        { label: "SYMBOL", value: (row) => row.symbol },
        { label: "NAME", value: (row) => row.name, maxWidth: 34 },
        { label: "PRICE", value: (row) => formatCurrency(row.price, 4) },
        { label: "VOL 24H", value: (row) => formatCompactCurrency(row.volume24h) },
        { label: "CONTRACTS", value: (row) => row.contractAddresses.length || "-" }
      ]);
    }
  }

  if (payload.coingecko.matches.length > 0) {
    console.log(
      payload.cmc.matches.length > 0 ||
        payload.cmc.selected ||
        payload.cmcCategories?.matches?.length > 0 ||
        payload.dinari?.matches?.length > 0
        ? "\nCoinGecko tokenized assets"
        : "CoinGecko tokenized assets"
    );
    printTable(payload.coingecko.matches, [
      { label: "SYMBOL", value: (row) => row.symbol },
      { label: "NAME", value: (row) => row.name, maxWidth: 32 },
      { label: "PRICE", value: (row) => formatCurrency(row.price, 4) },
      { label: "VOL 24H", value: (row) => formatCompactCurrency(row.volume24h) },
      { label: "MKT CAP", value: (row) => formatCompactCurrency(row.marketCap) },
      {
        label: "NETWORKS",
        value: (row) => row.supportedNetworks.map((network) => network.network).join(","),
        maxWidth: 28
      }
    ]);
  }
}

program
  .name("rwa")
  .description("Tokenized RWA market discovery and venue quotes")
  .option("--json", "Output raw JSON")
  .option("--agent", "Output structured machine-readable envelopes and errors")
  .version("0.2.0");

program
  .command("discover <query>")
  .description("Discover assets, tokenized wrappers, and venue coverage from CMC and CoinGecko")
  .option("--limit <count>", "Limit matches per source", "10")
  .option("--refresh", "Bypass the discovery cache and fetch fresh source data")
  .action(async (query, options) => {
    const requestedLimit = Number(options.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 10;
    let payload;

    setCacheBypass(Boolean(options.refresh));
    try {
      payload = await discoverAssets(query, limit);
    } finally {
      setCacheBypass(false);
    }

    emitSuccess(
      "discover",
      payload,
      options,
      renderDiscovery,
      {
        query: {
          query,
          limit,
          refresh: Boolean(options.refresh)
        },
        advisories: discoveryAdvisories()
      }
    );
  });

program
  .command("discover-snapshot <query>")
  .description("Build a normalized discovery snapshot for downstream ingestion")
  .option("--limit <count>", "Limit matched assets per source", "25")
  .option("--refresh", "Bypass the discovery cache and fetch fresh source data")
  .option("--out <path>", "Write the snapshot JSON to a file")
  .action(async (query, options) => {
    const requestedLimit = Number(options.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 25;
    let payload;

    setCacheBypass(Boolean(options.refresh));
    try {
      payload = await discoverAssets(query, limit);
    } finally {
      setCacheBypass(false);
    }

    const snapshot = buildDiscoverySnapshot(payload);

    if (options.out) {
      const outputPath = path.resolve(options.out);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify(snapshot, null, 2), "utf8");

      emitSuccess(
        "discover-snapshot",
        {
          path: outputPath,
          summary: snapshot.summary
        },
        options,
        (data) => {
          console.log(outputPath);
          console.log(
            `tokens=${data.summary.tokenCount} venuePairs=${data.summary.venuePairCount} exchanges=${data.summary.exchangeCount}`
          );
        },
        {
          query: {
            query,
            limit,
            refresh: Boolean(options.refresh)
          },
          advisories: discoveryAdvisories()
        }
      );
      return;
    }

    emitSuccess(
      "discover-snapshot",
      snapshot,
      options,
      (data) => {
        console.log(`query: ${data.query}`);
        console.log(`tokens: ${data.summary.tokenCount}`);
        console.log(`venue pairs: ${data.summary.venuePairCount}`);
        console.log(`exchanges: ${data.summary.exchangeCount}`);
        console.log(`categories: ${data.summary.categoryCount}`);
      },
      {
        query: {
          query,
          limit,
          refresh: Boolean(options.refresh)
        },
        advisories: discoveryAdvisories()
      }
    );
  });

const cacheCommand = program
  .command("cache")
  .description("Inspect or clear local cache");

cacheCommand
  .command("clear")
  .description("Clear local cache files")
  .action(async (options) => {
    const result = await clearCache();

    emitSuccess(
      "cache.clear",
      result,
      options,
      (payload) => {
        console.log(`Removed ${payload.removed} cache file(s) from ${payload.dir}`);
      }
    );
  });

cacheCommand
  .command("warm <source>")
  .description("Warm a cacheable source, e.g. ondo")
  .action(async (source, options) => {
    const target = String(source || "").trim().toLowerCase();

    if (target !== "ondo") {
      fail("UNKNOWN_CACHE_SOURCE", `Unknown cache warm source "${source}"`, { source }, 2);
    }

    const assets = await fetchOndoAssets();
    emitSuccess(
      "cache.warm",
      {
        source: target,
        assets: assets.length
      },
      options,
      (payload) => {
        console.log(`Warmed ${payload.source} asset list cache with ${payload.assets} asset(s)`);
      }
    );
  });

const configCommand = program
  .command("config")
  .description("Manage local API key and runtime configuration");

configCommand
  .command("set <key> <value>")
  .description("Persist a config value locally")
  .action(async (key, value, options) => {
    const result = setSetting(key, value);
    emitSuccess(
      "config.set",
      result,
      options,
      (payload) => {
        console.log(`Saved ${payload.key} to ${payload.path}`);
      }
    );
  });

configCommand
  .command("unset <key>")
  .description("Remove a persisted config value")
  .action(async (key, options) => {
    const result = unsetSetting(key);
    emitSuccess(
      "config.unset",
      result,
      options,
      (payload) => {
        console.log(`${payload.existed ? "Removed" : "No value for"} ${payload.key} in ${payload.path}`);
      }
    );
  });

configCommand
  .command("list")
  .description("List locally stored config values")
  .action(async (options) => {
    const values = listSettings();
    emitSuccess(
      "config.list",
      {
        path: getConfigPath(),
        values
      },
      options,
      (payload) => {
        console.log(payload.path);
        if (payload.values.length === 0) {
          console.log("(empty)");
          return;
        }
        printTable(payload.values, [
          { label: "KEY", value: (row) => row.key },
          { label: "VALUE", value: (row) => row.value, maxWidth: 48 }
        ]);
      }
    );
  });

program
  .command("venues")
  .description("Show supported venues and discovered market counts")
  .action(async (options) => {
    const markets = await listAllMarkets();
    const counts = [...VENUES.keys()].map((venue) => {
      const venueMarkets = markets.filter((market) => market.venue === venue);
      const assets = new Set(venueMarkets.map((market) => market.symbol));

      return {
        venue,
        markets: venueMarkets.length,
        assets: assets.size,
        spot: venueMarkets.filter((market) => market.type === "spot").length,
        perp: venueMarkets.filter((market) => market.type === "perp").length,
        issuer: venueMarkets.filter((market) => market.entityKind === "issuer").length
      };
    });

    emitSuccess("venues", counts, options, (rows) => {
      printTable(rows, [
        { label: "VENUE", value: (row) => row.venue },
        { label: "MARKETS", value: (row) => row.markets },
        { label: "ASSETS", value: (row) => row.assets },
        { label: "SPOT", value: (row) => row.spot },
        { label: "PERP", value: (row) => row.perp },
        { label: "ISSUER", value: (row) => row.issuer }
      ]);
    });
  });

program
  .command("assets")
  .description("List discovered tokenized assets")
  .option("-v, --venue <venue>", "Filter by venue")
  .action(async (options) => {
    const venue = normalizeVenueOption(options.venue);
    const assets = aggregateAssets(await listAllMarkets(venue));

    emitSuccess(
      "assets",
      {
        venue,
        count: assets.length,
        assets
      },
      options,
      (payload) => renderAssetTable(payload.assets),
      {
        query: {
          venue
        }
      }
    );
  });

program
  .command("resolve <asset>")
  .description("Resolve an asset query to canonical symbols and venue coverage")
  .option("-v, --venue <venue>", "Filter by venue")
  .option("--exact", "Only return exact canonical symbol or alias matches")
  .option("--limit <count>", "Limit matches", "20")
  .action(async (asset, options) => {
    const venue = normalizeVenueOption(options.venue);
    const assets = aggregateAssets(await listAllMarkets(venue));
    const requestedLimit = Number(options.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;
    const matches = resolveMatches(assets, asset, options.exact).slice(0, limit);

    emitSuccess(
      "resolve",
      {
        query: asset,
        venue,
        exact: Boolean(options.exact),
        matchCount: matches.length,
        matches
      },
      options,
      (payload) => renderAssetTable(payload.matches),
      {
        query: {
          asset,
          venue,
          exact: Boolean(options.exact),
          limit
        }
      }
    );
  });

program
  .command("quote <asset>")
  .description("Query a specific asset across venues")
  .option("-v, --venue <venue>", "Filter by venue")
  .option("--exact", "Require an exact canonical symbol or alias match")
  .action(async (asset, options) => {
    const venue = normalizeVenueOption(options.venue);
    const assets = aggregateAssets(await listAllMarkets(venue));
    const matches = resolveMatches(assets, asset, options.exact);

    if (matches.length === 0) {
      fail(
        "ASSET_NOT_FOUND",
        `No asset matched "${asset}"`,
        {
          asset,
          venue,
          exact: Boolean(options.exact)
        },
        3
      );
    }

    if (matches.length > 1) {
      fail(
        "ASSET_AMBIGUOUS",
        `Multiple assets matched "${asset}"`,
        {
          asset,
          venue,
          exact: Boolean(options.exact),
          candidates: matches.slice(0, 20).map((match) => ({
            symbol: match.symbol,
            name: match.name,
            entityKinds: match.entityKinds,
            category: match.category,
            venues: match.venues,
            marketTypes: match.marketTypes
          }))
        },
        4
      );
    }

    const [selected] = matches;
    const quotes = await getQuotesForSymbols([selected.symbol], venue);

    if (quotes.length === 0) {
      fail(
        "QUOTE_NOT_FOUND",
        `No quotes found for ${selected.symbol}`,
        {
          asset,
          symbol: selected.symbol,
          venue
        },
        5
      );
    }

    const payload = {
      asset: {
        symbol: selected.symbol,
        name: selected.name,
        category: selected.category,
        referencePrice: quotes.find((quote) => quote.referencePrice !== null)?.referencePrice ?? null
      },
      quoteCount: quotes.length,
      quotes
    };

    emitSuccess(
      "quote",
      payload,
      options,
      (data) => {
        const assetHeader = [
          data.asset.symbol,
          data.asset.name,
          `[${data.asset.category}]`,
          data.asset.referencePrice !== null
            ? `ref ${formatCurrency(data.asset.referencePrice, 4)}`
            : null
        ]
          .filter(Boolean)
          .join("  ");

        console.log(assetHeader);
        console.log("");
        const issuerOrOnchainQuotes = data.quotes.filter((quote) => isIssuerOrOnchainQuote(quote));
        const tradingQuotes = data.quotes.filter((quote) => !isIssuerOrOnchainQuote(quote));

        if (tradingQuotes.length > 0) {
          if (issuerOrOnchainQuotes.length > 0) {
            console.log("trading venues");
          }

          printTable(tradingQuotes, [
            { label: "VENUE", value: (row) => row.venue },
            { label: "ENTITY", value: (row) => row.entityKind },
            { label: "TICKER", value: (row) => row.venueTicker, maxWidth: 18 },
            { label: "TYPE", value: (row) => row.type },
            { label: "PRICE", value: (row) => formatCurrency(row.price, 4) },
            { label: "REF PX", value: (row) => formatCurrency(row.referencePrice, 4) },
            { label: "DEV", value: (row) => formatSignedPercent(row.priceDeviationPct, 2) },
            { label: "BID", value: (row) => formatCurrency(row.bid, 4) },
            { label: "ASK", value: (row) => formatCurrency(row.ask, 4) },
            { label: "+/-2% LIQ", value: (row) => formatCompactCurrency(row.liquidity2Pct) },
            { label: "VOLUME", value: (row) => formatCompactCurrency(quoteVolume(row)) },
            { label: "OI", value: (row) => formatCompactCurrency(row.openInterest) },
            { label: "FUNDING", value: (row) => formatPercent(row.fundingRate) }
          ]);
        }

        if (issuerOrOnchainQuotes.length > 0) {
          if (tradingQuotes.length > 0) {
            console.log("");
            console.log("issuer / onchain entities");
          }

          printTable(issuerOrOnchainQuotes, [
            { label: "VENUE", value: (row) => row.venue },
            { label: "ENTITY", value: (row) => row.entityKind },
            { label: "MODEL", value: (row) => row.executionModel ?? "-" },
            { label: "TICKER", value: (row) => row.venueTicker, maxWidth: 18 },
            { label: "TYPE", value: (row) => row.type },
            { label: "PRICE", value: (row) => formatCurrency(row.price, 4) },
            { label: "TVL", value: (row) => formatCompactCurrency(quoteTvl(row)) },
            { label: "+/-2% LIQ", value: (row) => formatCompactCurrency(quoteLiquidity2Pct(row)) },
            { label: "HOLDERS", value: (row) => row.holders ?? "-" },
            { label: "ONCHAIN MC", value: (row) => formatCompactCurrency(row.onchainMarketCap) },
            { label: "VOLUME", value: (row) => formatCompactCurrency(quoteVolume(row)) },
            { label: "MKTS", value: (row) => quoteOnchainMarketCount(row) ?? "-" },
            {
              label: "NETWORKS",
              value: (row) =>
                (row.supportedNetworks ?? []).map((network) => network.network).join(","),
              maxWidth: 24
            }
          ]);
        }

        for (const quote of data.quotes) {
          renderNetworkBreakdown(quote);
          renderOnchainNetworkBreakdown(quote);
          renderOnchainMarkets(quote);
          renderExplorerLinks(quote);
        }
      },
      {
        query: {
          asset,
          venue,
          exact: Boolean(options.exact)
        },
        advisories: quoteAdvisories(quotes)
      }
    );
  });

const exportCmd = program
  .command("export")
  .description("Export data in structured formats");

exportCmd
  .command("supabase-snapshot")
  .description("Export a versioned snapshot for Supabase import")
  .action(async (options) => {
    const { buildSupabaseSnapshot } = await import("./export/supabase-snapshot.js");
    const snapshot = await buildSupabaseSnapshot();

    const output = getOutputOptions(options);
    // Always output JSON for this command (it's machine-oriented)
    console.log(JSON.stringify(snapshot, null, output.json === false ? 0 : 2));
  });

program.parseAsync(process.argv).catch((error) => {
  const output = getOutputOptions();

  if (output.agent) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          command: program.args[0] ?? null,
          error: {
            code: error.code ?? "CLI_ERROR",
            message: error.message,
            details: error.details ?? {}
          }
        },
        null,
        2
      )
    );
  } else {
    console.error(`Error: ${error.message}`);
  }

  process.exitCode = error.exitCode ?? 1;
});
