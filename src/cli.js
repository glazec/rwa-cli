#!/usr/bin/env node

import { Command } from "commander";

import {
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
  formatSignedPercent,
  printTable
} from "./lib/format.js";
import {
  aggregateAssets,
  findExactMatchingAssets,
  findMatchingAssets
} from "./services/query.js";
import { discoverAssets } from "./services/discovery.js";
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
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  render(data);
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

  if (payload.coingecko.matches.length > 0) {
    console.log(payload.cmc.matches.length > 0 || payload.cmc.selected ? "\nCoinGecko tokenized gold" : "CoinGecko tokenized gold");
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
  .version("0.1.0");

program
  .command("discover <query>")
  .description("Discover assets, tokenized wrappers, and venue coverage from CMC and CoinGecko")
  .option("--limit <count>", "Limit matches per source", "10")
  .action(async (query, options) => {
    const requestedLimit = Number(options.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 10;
    const payload = await discoverAssets(query, limit);

    emitSuccess(
      "discover",
      payload,
      options,
      renderDiscovery,
      {
        query: {
          query,
          limit
        }
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
        printTable(data.quotes, [
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
          {
            label: "VOLUME",
            value: (row) => formatCompactCurrency(row.volume24h ?? row.volume30d)
          },
          { label: "OI", value: (row) => formatCompactCurrency(row.openInterest) },
          { label: "FUNDING", value: (row) => formatPercent(row.fundingRate) },
          {
            label: "NETWORKS",
            value: (row) =>
              (row.supportedNetworks ?? []).map((network) => network.network).join(","),
            maxWidth: 24
          }
        ]);

        for (const quote of data.quotes) {
          renderNetworkBreakdown(quote);
          renderExplorerLinks(quote);
        }
      },
      {
        query: {
          asset,
          venue,
          exact: Boolean(options.exact)
        }
      }
    );
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
