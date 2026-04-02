import { canonicalSymbol, inferCategory, isTradableRwaSymbol, resolveAliases, resolveAssetName } from "../lib/assets.js";
import { fetchJson, toNumber } from "../lib/http.js";
import { liquidityWithinPct, normalizeOrderBook } from "../lib/market.js";

const SYMBOLS_URL = "https://api.mexc.com/api/v3/exchangeInfo";
const TICKER_URL = "https://api.mexc.com/api/v3/ticker/24hr";
const DEPTH_URL = "https://api.mexc.com/api/v3/depth";

let symbolsCache = null;

function isRwaSymbol(value) {
  return /ONUSDT$/i.test(String(value || ""));
}

function symbolFromVenueTicker(venueTicker) {
  return canonicalSymbol(String(venueTicker || "").replace(/ONUSDT$/i, ""));
}

async function fetchSymbols() {
  if (symbolsCache) {
    return symbolsCache;
  }

  const json = await fetchJson(SYMBOLS_URL, { headers: { accept: "application/json" } }, 15000);
  symbolsCache = (json?.symbols ?? []).map((entry) => entry.symbol);
  return symbolsCache;
}

async function fetchTicker(venueTicker) {
  return fetchJson(
    `${TICKER_URL}?symbol=${encodeURIComponent(venueTicker)}`,
    { headers: { accept: "application/json" } },
    12000
  );
}

async function fetchDepth(venueTicker) {
  const json = await fetchJson(
    `${DEPTH_URL}?symbol=${encodeURIComponent(venueTicker)}&limit=50`,
    { headers: { accept: "application/json" } },
    12000
  );

  return normalizeOrderBook(json);
}

export async function listMarkets() {
  const symbols = await fetchSymbols();

  return symbols
    .filter(isRwaSymbol)
    .map((venueTicker) => {
      const symbol = symbolFromVenueTicker(venueTicker);
      const name = resolveAssetName(symbol);

      return {
        venue: "mexc",
        venueTicker,
        symbol,
        name,
        type: "spot",
        category: inferCategory(symbol, name),
        aliases: resolveAliases(symbol, venueTicker, name),
        raw: { venueTicker }
      };
    })
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const venueTickers = (await fetchSymbols()).filter(isRwaSymbol);

  const matched = venueTickers
    .map((venueTicker) => {
      const symbol = symbolFromVenueTicker(venueTicker);
      const name = resolveAssetName(symbol);
      return { venueTicker, symbol, name };
    })
    .filter((market) => wanted.has(market.symbol))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));

  return await Promise.all(
    matched.map(async (market) => {
      const [ticker, book] = await Promise.all([
        fetchTicker(market.venueTicker).catch(() => null),
        fetchDepth(market.venueTicker).catch(() => null)
      ]);

      return {
        venue: "mexc",
        venueTicker: market.venueTicker,
        symbol: market.symbol,
        name: market.name,
        type: "spot",
        price: toNumber(ticker?.lastPrice),
        bid: toNumber(ticker?.bidPrice),
        ask: toNumber(ticker?.askPrice),
        liquidity2Pct: book ? liquidityWithinPct(book) : null,
        volume24h: toNumber(ticker?.quoteVolume),
        volume30d: null,
        openInterest: null,
        fundingRate: null,
        fundingRateApr: null,
        category: inferCategory(market.symbol, market.name),
        source: `${TICKER_URL}?symbol=${market.venueTicker} + ${DEPTH_URL}`
      };
    })
  );
}
