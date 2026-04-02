import WebSocket from "ws";

import { fetchJson, toNumber } from "../lib/http.js";
import { annualizeFunding, liquidityWithinPct, normalizeOrderBook } from "../lib/market.js";
import {
  canonicalSymbol,
  inferCategory,
  isTradableRwaSymbol,
  resolveAliases,
  resolveAssetName
} from "../lib/assets.js";

const API_BASE = "https://server-prod.hz.vestmarkets.com/v2";
const WS_URL = "wss://ws-beta-prod.hz.vestmarkets.com/ws?version=1.0&xwebsocketserver=restserver0";

async function fetchExchangeInfo() {
  const json = await fetchJson(`${API_BASE}/exchangeInfo`, {}, 12000);
  return json?.symbols ?? [];
}

async function fetchLatestTickers() {
  const json = await fetchJson(`${API_BASE}/ticker/latest`, {}, 12000);
  return json?.tickers ?? [];
}

async function fetchTicker24h(symbols) {
  if (symbols.length === 0) {
    return [];
  }

  const json = await fetchJson(
    `${API_BASE}/ticker/24hr?symbols=${encodeURIComponent(symbols.join(","))}`,
    {},
    12000
  );

  return json?.tickers ?? [];
}

async function fetchOpenInterest(symbols) {
  if (symbols.length === 0) {
    return [];
  }

  const json = await fetchJson(
    `${API_BASE}/oi?symbols=${encodeURIComponent(symbols.join(","))}`,
    {},
    12000
  );

  return json?.ois ?? [];
}

function normalizeVestSymbol(venueTicker) {
  return canonicalSymbol(String(venueTicker ?? "").replace(/-USD-PERP$/i, ""));
}

function subscribeDepth(venueTicker) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const channel = `${venueTicker}@depth`;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for vest depth for ${venueTicker}`));
    }, 8000);

    const cleanup = () => clearTimeout(timer);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          method: "SUBSCRIBE",
          params: [channel],
          id: 1
        })
      );
    });

    ws.on("message", (buffer) => {
      try {
        const message = JSON.parse(buffer.toString());
        if (message?.channel !== channel) {
          return;
        }

        cleanup();
        ws.close();
        resolve(
          normalizeOrderBook({
            bids: message?.data?.bids ?? [],
            asks: message?.data?.asks ?? []
          })
        );
      } catch (error) {
        cleanup();
        ws.close();
        reject(error);
      }
    });

    ws.on("error", (error) => {
      cleanup();
      reject(error);
    });
  });
}

export async function listMarkets() {
  const symbols = await fetchExchangeInfo();

  return symbols
    .filter((entry) => entry.asset === "stock")
    .filter((entry) => entry.tradingStatus === "TRADING")
    .map((entry) => {
      const symbol = normalizeVestSymbol(entry.symbol);
      const name = resolveAssetName(symbol, entry.displayName);

      return {
        venue: "vest",
        venueTicker: String(entry.symbol),
        symbol,
        name,
        type: "perp",
        category: inferCategory(symbol, name),
        aliases: resolveAliases(symbol, entry.symbol, name),
        raw: entry
      };
    })
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const listings = await listMarkets();
  const matched = listings.filter((market) => wanted.has(market.symbol));

  if (matched.length === 0) {
    return [];
  }

  const venueTickers = matched.map((market) => market.venueTicker);
  const [latestTickers, tickers24h, openInterestRows, books] = await Promise.all([
    fetchLatestTickers(),
    fetchTicker24h(venueTickers),
    fetchOpenInterest(venueTickers),
    Promise.all(
      matched.map(async (market) => {
        try {
          return [market.venueTicker, await subscribeDepth(market.venueTicker)];
        } catch {
          return [market.venueTicker, null];
        }
      })
    )
  ]);

  const latestByTicker = new Map(latestTickers.map((ticker) => [ticker.symbol, ticker]));
  const statsByTicker = new Map(tickers24h.map((ticker) => [ticker.symbol, ticker]));
  const oiByTicker = new Map(openInterestRows.map((row) => [row.symbol, row]));
  const booksByTicker = new Map(books);

  return matched.map((market) => {
    const latest = latestByTicker.get(market.venueTicker) ?? {};
    const stats = statsByTicker.get(market.venueTicker) ?? {};
    const oi = oiByTicker.get(market.venueTicker) ?? {};
    const book = booksByTicker.get(market.venueTicker);
    const bid = book?.bids?.[0]?.price ?? null;
    const ask = book?.asks?.[0]?.price ?? null;
    const markPrice = toNumber(latest.markPrice);
    const indexPrice = toNumber(latest.indexPrice) ?? markPrice;
    const longOi = toNumber(oi.longOi) ?? 0;
    const shortOi = toNumber(oi.shortOi) ?? 0;
    const oneHrFundingRate = toNumber(latest.oneHrFundingRate);

    return {
      venue: "vest",
      venueTicker: market.venueTicker,
      symbol: market.symbol,
      name: market.name,
      type: "perp",
      price: markPrice,
      bid,
      ask,
      liquidity2Pct: book ? liquidityWithinPct(book) : null,
      volume24h: toNumber(stats.quoteVolume),
      openInterest:
        indexPrice !== null ? (longOi + shortOi) * indexPrice : null,
      fundingRate: oneHrFundingRate !== null ? oneHrFundingRate * 100 : null,
      fundingRateApr:
        oneHrFundingRate !== null ? annualizeFunding(oneHrFundingRate, 1) : null,
      category: market.category,
      source: `${API_BASE}/exchangeInfo + ticker/latest + ticker/24hr + oi + websocket`
    };
  });
}
