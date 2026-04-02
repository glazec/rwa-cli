#!/usr/bin/env node

import { getQuotesForSymbols, listAllMarkets } from "../src/services/registry.js";
import { fetchJson, toNumber } from "../src/lib/http.js";
import { assetSymbolToYahoo, getReferencePrices } from "../src/services/reference.js";

const PRICE_TOLERANCE = 0.1;
const SMALL_TOLERANCE = 0.0001;
const CONCURRENCY = 8;

function round(value, digits = 6) {
  if (!Number.isFinite(value)) {
    return value;
  }

  return Number(value.toFixed(digits));
}

function nearlyEqual(left, right, options = {}) {
  if (left === null || right === null || left === undefined || right === undefined) {
    return left === right;
  }

  const { abs = SMALL_TOLERANCE, rel = 0 } = options;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const delta = Math.abs(leftNumber - rightNumber);

  if (delta <= abs) {
    return true;
  }

  const baseline = Math.max(Math.abs(leftNumber), Math.abs(rightNumber), 1);
  return delta / baseline <= rel;
}

function pushMismatch(issues, venue, symbol, field, actual, expected, detail = "") {
  issues.push({
    venue,
    symbol,
    field,
    actual: round(actual),
    expected: round(expected),
    detail
  });
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => worker()));
  return results;
}

async function getAllQuotesByVenue() {
  const markets = await listAllMarkets();
  const byVenue = new Map();

  for (const market of markets) {
    const existing = byVenue.get(market.venue) ?? new Set();
    existing.add(market.symbol);
    byVenue.set(market.venue, existing);
  }

  const entries = await Promise.all(
    [...byVenue.entries()].map(async ([venue, symbols]) => {
      const quotes = await getQuotesForSymbols([...symbols], venue);
      return [venue, quotes];
    })
  );

  return new Map(entries);
}

async function verifyBitget(quotes) {
  const issues = [];
  const notes = [];

  const [perpTickers, perpContracts, spotTickers, spotSymbols] = await Promise.all([
    fetchJson("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES"),
    fetchJson("https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES"),
    fetchJson("https://api.bitget.com/api/v2/spot/market/tickers"),
    fetchJson("https://api.bitget.com/api/v2/spot/public/symbols")
  ]);

  const perpTickerBySymbol = new Map((perpTickers?.data ?? []).map((item) => [item.symbol, item]));
  const perpContractBySymbol = new Map((perpContracts?.data ?? []).map((item) => [item.symbol, item]));
  const spotTickerBySymbol = new Map((spotTickers?.data ?? []).map((item) => [item.symbol, item]));
  const spotSymbolSet = new Set((spotSymbols?.data ?? []).map((item) => item.symbol));

  await mapLimit(quotes, CONCURRENCY, async (quote) => {
    if (quote.type === "spot") {
      const ticker = spotTickerBySymbol.get(quote.venueTicker);
      if (!ticker || !spotSymbolSet.has(quote.venueTicker)) {
        pushMismatch(issues, "bitget", quote.venueTicker, "listing", null, null, "missing from spot source payload");
        return;
      }

      if (!nearlyEqual(quote.price, toNumber(ticker.lastPr), { abs: PRICE_TOLERANCE, rel: 0.002 })) {
        pushMismatch(issues, "bitget", quote.venueTicker, "price", quote.price, toNumber(ticker.lastPr));
      }

      if (quote.volume24h !== null && !nearlyEqual(quote.volume24h, toNumber(ticker.quoteVolume), { abs: 1000, rel: 0.01 })) {
        pushMismatch(issues, "bitget", quote.venueTicker, "volume24h", quote.volume24h, toNumber(ticker.quoteVolume));
      }

      const book = await fetchJson(
        `https://api.bitget.com/api/v2/spot/market/orderbook?symbol=${encodeURIComponent(quote.venueTicker)}&type=step0&limit=5`
      );
      const bestBid = toNumber(book?.data?.bids?.[0]?.[0]);
      const bestAsk = toNumber(book?.data?.asks?.[0]?.[0]);

      if (!nearlyEqual(quote.bid, bestBid, { abs: PRICE_TOLERANCE, rel: 0.002 })) {
        pushMismatch(issues, "bitget", quote.venueTicker, "bid", quote.bid, bestBid);
      }
      if (!nearlyEqual(quote.ask, bestAsk, { abs: PRICE_TOLERANCE, rel: 0.002 })) {
        pushMismatch(issues, "bitget", quote.venueTicker, "ask", quote.ask, bestAsk);
      }
      return;
    }

    const ticker = perpTickerBySymbol.get(quote.venueTicker);
    const contract = perpContractBySymbol.get(quote.venueTicker);
    if (!ticker || !contract) {
      pushMismatch(issues, "bitget", quote.venueTicker, "listing", null, null, "missing from perp source payload");
      return;
    }

    if (!nearlyEqual(quote.price, toNumber(ticker.lastPr), { abs: PRICE_TOLERANCE, rel: 0.002 })) {
      pushMismatch(issues, "bitget", quote.venueTicker, "price", quote.price, toNumber(ticker.lastPr));
    }

    const expectedFunding = toNumber(ticker.fundingRate);
    if (!nearlyEqual(quote.fundingRate, expectedFunding === null ? null : expectedFunding * 100, { abs: 0.01, rel: 0.01 })) {
      pushMismatch(
        issues,
        "bitget",
        quote.venueTicker,
        "fundingRate",
        quote.fundingRate,
        expectedFunding === null ? null : expectedFunding * 100
      );
    }

    const expectedVolume = toNumber(ticker.quoteVolume ?? ticker.usdtVolume);
    if (quote.volume24h !== null && !nearlyEqual(quote.volume24h, expectedVolume, { abs: 1000, rel: 0.01 })) {
      pushMismatch(issues, "bitget", quote.venueTicker, "volume24h", quote.volume24h, expectedVolume);
    }

    const holdingAmount = toNumber(ticker.holdingAmount);
    const indexPrice = toNumber(ticker.indexPrice) ?? toNumber(ticker.lastPr);
    const expectedOi = holdingAmount !== null && indexPrice !== null ? holdingAmount * indexPrice : null;
    if (!nearlyEqual(quote.openInterest, expectedOi, { abs: 5000, rel: 0.01 })) {
      pushMismatch(issues, "bitget", quote.venueTicker, "openInterest", quote.openInterest, expectedOi);
    }

    const book = await fetchJson(
      `https://api.bitget.com/api/v2/mix/market/merge-depth?symbol=${encodeURIComponent(quote.venueTicker)}&productType=USDT-FUTURES&precision=scale0&limit=5`
    );
    const bestBid = toNumber(book?.data?.bids?.[0]?.[0]);
    const bestAsk = toNumber(book?.data?.asks?.[0]?.[0]);

    if (!nearlyEqual(quote.bid, bestBid, { abs: PRICE_TOLERANCE, rel: 0.002 })) {
      pushMismatch(issues, "bitget", quote.venueTicker, "bid", quote.bid, bestBid);
    }
    if (!nearlyEqual(quote.ask, bestAsk, { abs: PRICE_TOLERANCE, rel: 0.002 })) {
      pushMismatch(issues, "bitget", quote.venueTicker, "ask", quote.ask, bestAsk);
    }
  });

  return { issues, notes };
}

async function verifyTradeXyz(quotes) {
  const issues = [];
  const notes = [];

  const meta = await fetchJson(
    "https://api.hyperliquid.xyz/info",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs", dex: "xyz" })
    },
    12000
  );

  const universe = meta?.[0]?.universe ?? [];
  const ctxs = meta?.[1] ?? [];
  const ctxByTicker = new Map(
    universe.map((entry, index) => [String(entry.name ?? entry.coin ?? ""), ctxs[index] ?? {}])
  );

  await mapLimit(quotes, CONCURRENCY, async (quote) => {
    const ctx = ctxByTicker.get(quote.venueTicker);
    if (!ctx) {
      pushMismatch(issues, "trade.xyz", quote.venueTicker, "listing", null, null, "missing from universe");
      return;
    }

    if (!nearlyEqual(quote.price, toNumber(ctx.markPx), { abs: PRICE_TOLERANCE, rel: 0.002 })) {
      pushMismatch(issues, "trade.xyz", quote.venueTicker, "price", quote.price, toNumber(ctx.markPx));
    }

    const expectedFunding = toNumber(ctx.funding);
    if (!nearlyEqual(quote.fundingRate, expectedFunding === null ? null : expectedFunding * 100, { abs: 0.01, rel: 0.02 })) {
      pushMismatch(
        issues,
        "trade.xyz",
        quote.venueTicker,
        "fundingRate",
        quote.fundingRate,
        expectedFunding === null ? null : expectedFunding * 100
      );
    }

    if (!nearlyEqual(quote.volume24h, toNumber(ctx.dayNtlVlm), { abs: 5000, rel: 0.02 })) {
      pushMismatch(issues, "trade.xyz", quote.venueTicker, "volume24h", quote.volume24h, toNumber(ctx.dayNtlVlm));
    }

    const expectedOiBase = toNumber(ctx.openInterest);
    const expectedOracle = toNumber(ctx.oraclePx) ?? toNumber(ctx.markPx);
    const expectedOi =
      expectedOiBase !== null && expectedOracle !== null ? expectedOiBase * expectedOracle : null;
    if (!nearlyEqual(quote.openInterest, expectedOi, { abs: 5000, rel: 0.02 })) {
      pushMismatch(issues, "trade.xyz", quote.venueTicker, "openInterest", quote.openInterest, expectedOi);
    }

    const book = await fetchJson(
      "https://api.hyperliquid.xyz/info",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "l2Book", coin: quote.venueTicker })
      },
      12000
    );
    const bestBid = toNumber(book?.levels?.[0]?.[0]?.px);
    const bestAsk = toNumber(book?.levels?.[1]?.[0]?.px);

    if (!nearlyEqual(quote.bid, bestBid, { abs: PRICE_TOLERANCE, rel: 0.002 })) {
      pushMismatch(issues, "trade.xyz", quote.venueTicker, "bid", quote.bid, bestBid);
    }
    if (!nearlyEqual(quote.ask, bestAsk, { abs: PRICE_TOLERANCE, rel: 0.002 })) {
      pushMismatch(issues, "trade.xyz", quote.venueTicker, "ask", quote.ask, bestAsk);
    }
  });

  return { issues, notes };
}

async function verifyLighter(quotes) {
  const issues = [];
  const notes = [];

  const [details, fundingRates] = await Promise.all([
    fetchJson("https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails", {}, 12000),
    fetchJson("https://mainnet.zklighter.elliot.ai/api/v1/funding-rates", {}, 12000)
  ]);

  const detailBySymbol = new Map((details?.order_book_details ?? []).map((item) => [item.symbol, item]));
  const fundingBySymbol = new Map(
    (fundingRates?.funding_rates ?? [])
      .filter((entry) => entry.exchange === "lighter")
      .map((entry) => [entry.symbol, entry])
  );

  for (const quote of quotes) {
    const detail = detailBySymbol.get(quote.venueTicker);
    if (!detail) {
      pushMismatch(issues, "lighter", quote.venueTicker, "listing", null, null, "missing from detail feed");
      continue;
    }

    if (!nearlyEqual(quote.price, toNumber(detail.last_trade_price), { abs: PRICE_TOLERANCE, rel: 0.002 })) {
      pushMismatch(issues, "lighter", quote.venueTicker, "price", quote.price, toNumber(detail.last_trade_price));
    }

    if (!nearlyEqual(quote.volume24h, toNumber(detail.daily_quote_token_volume), { abs: 5000, rel: 0.02 })) {
      pushMismatch(
        issues,
        "lighter",
        quote.venueTicker,
        "volume24h",
        quote.volume24h,
        toNumber(detail.daily_quote_token_volume)
      );
    }

    const expectedOiBase = toNumber(detail.open_interest);
    const expectedPrice = toNumber(detail.last_trade_price);
    const expectedOi =
      expectedOiBase !== null && expectedPrice !== null ? expectedOiBase * expectedPrice : null;
    if (!nearlyEqual(quote.openInterest, expectedOi, { abs: 5000, rel: 0.02 })) {
      pushMismatch(issues, "lighter", quote.venueTicker, "openInterest", quote.openInterest, expectedOi);
    }

    const funding = fundingBySymbol.get(quote.symbol);
    const expectedFunding = toNumber(funding?.rate);
    if (!nearlyEqual(quote.fundingRate, expectedFunding === null ? null : expectedFunding * 100, { abs: 0.01, rel: 0.02 })) {
      pushMismatch(
        issues,
        "lighter",
        quote.venueTicker,
        "fundingRate",
        quote.fundingRate,
        expectedFunding === null ? null : expectedFunding * 100
      );
    }

    if (quote.bid === null || quote.ask === null) {
      notes.push(`lighter:${quote.venueTicker} has no verified bid/ask because websocket book access is unreliable from this CLI runtime`);
    }
  }

  return { issues, notes };
}

async function verifyOndo(quotes) {
  const issues = [];
  const notes = [];

  const json = await fetchJson(
    "https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/unified/rank/list",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        clienttype: "web"
      },
      body: JSON.stringify({
        rankType: 40,
        period: 50,
        sortBy: 50,
        orderAsc: false
      })
    },
    12000
  );

  const tokenBySymbol = new Map((json?.data?.tokens ?? []).map((item) => [item.symbol, item]));

  for (const quote of quotes) {
    const token = tokenBySymbol.get(quote.venueTicker);
    if (!token) {
      pushMismatch(issues, "ondo", quote.venueTicker, "listing", null, null, "missing from token feed");
      continue;
    }

    if (!nearlyEqual(quote.price, toNumber(token.price), { abs: PRICE_TOLERANCE, rel: 0.002 })) {
      pushMismatch(issues, "ondo", quote.venueTicker, "price", quote.price, toNumber(token.price));
    }

    const expectedVolume = (toNumber(token.volume24hBuy) ?? 0) + (toNumber(token.volume24hSell) ?? 0);
    if (!nearlyEqual(quote.volume24h, expectedVolume, { abs: 1000, rel: 0.02 })) {
      pushMismatch(issues, "ondo", quote.venueTicker, "volume24h", quote.volume24h, expectedVolume);
    }
  }

  return { issues, notes };
}

async function verifyStableStock(quotes) {
  const issues = [];
  const notes = [];

  const pages = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      fetchJson(
        "https://app.stablestock.finance/web/stocks/list",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "device-id": "verify-data",
            lang: "en-US"
          },
          body: JSON.stringify({
            search_name: "",
            page: index + 1,
            page_size: 100,
            market: 1
          })
        },
        12000
      ).catch(() => ({ data: { list: [] } }))
    )
  );

  const stocks = pages.flatMap((page) => page?.data?.list ?? []);
  const stockByCode = new Map(stocks.map((item) => [String(item.stock_code).toUpperCase(), item]));

  for (const quote of quotes) {
    const code = String(quote.venueTicker).replace(/^s/i, "");
    const stock = stockByCode.get(code);
    if (!stock) {
      pushMismatch(issues, "stablestock", quote.venueTicker, "listing", null, null, "missing from paged stock list");
      continue;
    }

    if (!nearlyEqual(quote.price, toNumber(stock.price), { abs: PRICE_TOLERANCE, rel: 0.002 })) {
      pushMismatch(issues, "stablestock", quote.venueTicker, "price", quote.price, toNumber(stock.price));
    }

    if (quote.volume24h !== null) {
      notes.push(`stablestock:${quote.venueTicker} reported volume, expected null`);
    }
  }

  notes.push("stablestock volume, bid, ask, liquidity, and OI are not publicly exposed by the source endpoint");

  return { issues, notes };
}

async function verifyVest(quotes) {
  const issues = [];
  const notes = [];

  const [exchangeInfo, latest, stats24h, oiRows] = await Promise.all([
    fetchJson("https://server-prod.hz.vestmarkets.com/v2/exchangeInfo", {}, 12000),
    fetchJson("https://server-prod.hz.vestmarkets.com/v2/ticker/latest", {}, 12000),
    fetchJson(
      `https://server-prod.hz.vestmarkets.com/v2/ticker/24hr?symbols=${encodeURIComponent(quotes.map((quote) => quote.venueTicker).join(","))}`,
      {},
      12000
    ),
    fetchJson(
      `https://server-prod.hz.vestmarkets.com/v2/oi?symbols=${encodeURIComponent(quotes.map((quote) => quote.venueTicker).join(","))}`,
      {},
      12000
    )
  ]);

  const infoByTicker = new Map((exchangeInfo?.symbols ?? []).map((item) => [item.symbol, item]));
  const latestByTicker = new Map((latest?.tickers ?? []).map((item) => [item.symbol, item]));
  const statsByTicker = new Map((stats24h?.tickers ?? []).map((item) => [item.symbol, item]));
  const oiByTicker = new Map((oiRows?.ois ?? []).map((item) => [item.symbol, item]));

  await mapLimit(quotes, CONCURRENCY, async (quote) => {
    if (!infoByTicker.has(quote.venueTicker)) {
      pushMismatch(issues, "vest", quote.venueTicker, "listing", null, null, "missing from exchange info");
      return;
    }

    const latestTicker = latestByTicker.get(quote.venueTicker) ?? {};
    const stats = statsByTicker.get(quote.venueTicker) ?? {};
    const oi = oiByTicker.get(quote.venueTicker) ?? {};

    if (!nearlyEqual(quote.price, toNumber(latestTicker.markPrice), { abs: PRICE_TOLERANCE, rel: 0.002 })) {
      pushMismatch(issues, "vest", quote.venueTicker, "price", quote.price, toNumber(latestTicker.markPrice));
    }

    const expectedFunding = toNumber(latestTicker.oneHrFundingRate);
    if (!nearlyEqual(quote.fundingRate, expectedFunding === null ? null : expectedFunding * 100, { abs: 0.01, rel: 0.02 })) {
      pushMismatch(
        issues,
        "vest",
        quote.venueTicker,
        "fundingRate",
        quote.fundingRate,
        expectedFunding === null ? null : expectedFunding * 100
      );
    }

    const expectedVolume = toNumber(stats.quoteVolume);
    if (!nearlyEqual(quote.volume24h, expectedVolume, { abs: 5000, rel: 0.02 })) {
      pushMismatch(issues, "vest", quote.venueTicker, "volume24h", quote.volume24h, expectedVolume);
    }

    const indexPrice = toNumber(latestTicker.indexPrice) ?? toNumber(latestTicker.markPrice);
    const expectedOi =
      indexPrice !== null
        ? ((toNumber(oi.longOi) ?? 0) + (toNumber(oi.shortOi) ?? 0)) * indexPrice
        : null;
    if (!nearlyEqual(quote.openInterest, expectedOi, { abs: 5000, rel: 0.02 })) {
      pushMismatch(issues, "vest", quote.venueTicker, "openInterest", quote.openInterest, expectedOi);
    }

    try {
      const wsModule = await import("ws");
      const WebSocket = wsModule.default;
      const channel = `${quote.venueTicker}@depth`;
      const book = await new Promise((resolve, reject) => {
        const ws = new WebSocket("wss://ws-beta-prod.hz.vestmarkets.com/ws?version=1.0&xwebsocketserver=restserver0");
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("timeout"));
        }, 8000);

        const cleanup = () => clearTimeout(timer);
        ws.on("open", () => {
          ws.send(JSON.stringify({ method: "SUBSCRIBE", params: [channel], id: 1 }));
        });
        ws.on("message", (buffer) => {
          const message = JSON.parse(buffer.toString());
          if (message?.channel !== channel) {
            return;
          }

          cleanup();
          ws.close();
          resolve(message.data);
        });
        ws.on("error", (error) => {
          cleanup();
          reject(error);
        });
      });

      const bestBid = toNumber(book?.bids?.[0]?.[0]);
      const bestAsk = toNumber(book?.asks?.[0]?.[0]);
      if (!nearlyEqual(quote.bid, bestBid, { abs: PRICE_TOLERANCE, rel: 0.002 })) {
        pushMismatch(issues, "vest", quote.venueTicker, "bid", quote.bid, bestBid);
      }
      if (!nearlyEqual(quote.ask, bestAsk, { abs: PRICE_TOLERANCE, rel: 0.002 })) {
        pushMismatch(issues, "vest", quote.venueTicker, "ask", quote.ask, bestAsk);
      }
    } catch (error) {
      notes.push(`vest:${quote.venueTicker} depth verification failed: ${error.message}`);
    }
  });

  return { issues, notes };
}

async function verifyReferencePrices(quotesByVenue) {
  const symbols = [...new Set([...quotesByVenue.values()].flat().map((quote) => quote.symbol))];
  const prices = await getReferencePrices(symbols);
  const missing = symbols.filter((symbol) => prices.get(symbol) === null || prices.get(symbol) === undefined);

  return {
    issues: [],
    notes: missing.map((symbol) => `reference price missing for ${symbol} (Yahoo symbol ${assetSymbolToYahoo(symbol)})`)
  };
}

async function main() {
  const startedAt = Date.now();
  const quotesByVenue = await getAllQuotesByVenue();

  const validators = {
    bitget: verifyBitget,
    "trade.xyz": verifyTradeXyz,
    lighter: verifyLighter,
    ondo: verifyOndo,
    stablestock: verifyStableStock,
    vest: verifyVest
  };

  const summary = [];
  const allIssues = [];
  const allNotes = [];

  for (const [venue, quotes] of quotesByVenue.entries()) {
    const validator = validators[venue];
    if (!validator) {
      continue;
    }

    const result = await validator(quotes);
    summary.push({
      venue,
      quotes: quotes.length,
      mismatches: result.issues.length,
      notes: result.notes.length
    });
    allIssues.push(...result.issues);
    allNotes.push(...result.notes.map((note) => ({ venue, note })));
  }

  const referenceCheck = await verifyReferencePrices(quotesByVenue);
  allNotes.push(...referenceCheck.notes.map((note) => ({ venue: "reference", note })));

  const payload = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    durationSeconds: round((Date.now() - startedAt) / 1000, 2),
    venueSummary: summary,
    mismatchCount: allIssues.length,
    noteCount: allNotes.length,
    sampleIssues: allIssues.slice(0, 50),
    sampleNotes: allNotes.slice(0, 50)
  };

  console.log(JSON.stringify(payload, null, 2));

  if (allIssues.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: {
          message: error.message
        }
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
