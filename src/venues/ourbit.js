import { canonicalSymbol, inferCategory, isKnownAsset, isTradableRwaSymbol, resolveAliases, resolveAssetName } from "../lib/assets.js";
import { fetchJson, toNumber } from "../lib/http.js";
import { liquidityWithinPct, normalizeOrderBook } from "../lib/market.js";

const SYMBOLS_URL = "https://www.ourbit.com/api/platform/spot/market/v2/symbols";
const TICKERS_URL = "https://www.ourbit.com/api/platform/spot/market/v2/tickers";
const TICKER_URL = "https://www.ourbit.com/api/platform/spot/market/v2/symbol/ticker";
const DEPTH_URL = "https://www.ourbit.com/api/platform/spot/market/depth";

let symbolsCache = null;
let tickersCache = null;

function baseSymbolFromTicker(venueTicker) {
  return String(venueTicker || "")
    .trim()
    .toUpperCase()
    .replace(/_USDT$/i, "");
}

function normalizeVenueSymbol(venueTicker) {
  const base = baseSymbolFromTicker(venueTicker);

  for (const suffix of ["ON", "X"]) {
    if (!base.endsWith(suffix)) {
      continue;
    }

    const candidate = base.slice(0, -suffix.length);
    if (candidate && isKnownAsset(candidate)) {
      return canonicalSymbol(candidate);
    }
  }

  return canonicalSymbol(base);
}

function isRwaSymbol(venueTicker) {
  const base = baseSymbolFromTicker(venueTicker);
  if (!base || !String(venueTicker || "").toLowerCase().endsWith("_usdt")) {
    return false;
  }

  if (/(3L|3S)$/i.test(base)) {
    return false;
  }

  if (["PAXG", "XAUT"].includes(base)) {
    return true;
  }

  if (isKnownAsset(base) || isKnownAsset(canonicalSymbol(base))) {
    return true;
  }

  return ["ON", "X"].some((suffix) => {
    if (!base.endsWith(suffix)) {
      return false;
    }

    const candidate = base.slice(0, -suffix.length);
    return candidate && isKnownAsset(candidate);
  });
}

async function fetchSymbols() {
  if (symbolsCache) {
    return symbolsCache;
  }

  const json = await fetchJson(SYMBOLS_URL, { headers: { accept: "application/json" } }, 15000);
  const symbolsByQuote = json?.data ?? {};
  symbolsCache = Object.entries(symbolsByQuote).flatMap(([quoteSymbol, entries]) =>
    (Array.isArray(entries) ? entries : []).map((entry) => ({
      venueTicker: `${entry.vn}_${quoteSymbol}`.toUpperCase(),
      baseSymbol: String(entry.vn || "").toUpperCase(),
      quoteSymbol: String(quoteSymbol || "").toUpperCase(),
      name: entry.fn ?? entry.vna ?? entry.vn ?? null
    }))
  );
  return symbolsCache;
}

async function fetchTickers() {
  if (tickersCache) {
    return tickersCache;
  }

  const json = await fetchJson(TICKERS_URL, { headers: { accept: "application/json" } }, 15000);
  tickersCache = new Map((json?.data ?? []).map((entry) => [String(entry.sb || "").toUpperCase(), entry]));
  return tickersCache;
}

async function fetchTicker(venueTicker) {
  const json = await fetchJson(
    `${TICKER_URL}?symbol=${encodeURIComponent(venueTicker)}`,
    { headers: { accept: "application/json" } },
    12000
  );

  return json?.data ?? null;
}

async function fetchOrderBook(venueTicker) {
  const json = await fetchJson(
    `${DEPTH_URL}?symbol=${encodeURIComponent(venueTicker)}`,
    { headers: { accept: "application/json" } },
    12000
  );

  return normalizeOrderBook(json?.data?.data);
}

function toMarket(entry) {
  const symbol = normalizeVenueSymbol(entry.venueTicker);
  const name = resolveAssetName(symbol) || entry.name || entry.baseSymbol;

  return {
    venue: "ourbit",
    venueTicker: entry.venueTicker,
    symbol,
    name,
    type: "spot",
    category: inferCategory(symbol, name),
    aliases: resolveAliases(symbol, entry.venueTicker, name),
    raw: { venueTicker: entry.venueTicker }
  };
}

export async function listMarkets() {
  const symbols = await fetchSymbols();

  return symbols
    .filter((entry) => entry.quoteSymbol === "USDT")
    .filter((entry) => isRwaSymbol(entry.venueTicker))
    .map((entry) => toMarket(entry))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const markets = (await listMarkets()).filter((market) => wanted.has(market.symbol));
  const tickers = await fetchTickers();

  return await Promise.all(
    markets.map(async (market) => {
      const [ticker, detailedTicker, book] = await Promise.all([
        Promise.resolve(tickers.get(market.venueTicker) ?? null),
        fetchTicker(market.venueTicker).catch(() => null),
        fetchOrderBook(market.venueTicker).catch(() => null)
      ]);

      return {
        venue: "ourbit",
        venueTicker: market.venueTicker,
        symbol: market.symbol,
        name: market.name,
        type: "spot",
        price: toNumber(detailedTicker?.c ?? ticker?.c),
        bid: book?.bids?.[0]?.price ?? null,
        ask: book?.asks?.[0]?.price ?? null,
        liquidity2Pct: book ? liquidityWithinPct(book) : null,
        volume24h: toNumber(detailedTicker?.a ?? ticker?.a),
        volume30d: null,
        openInterest: null,
        fundingRate: null,
        fundingRateApr: null,
        category: inferCategory(market.symbol, market.name),
        source: `${TICKER_URL}?symbol=${market.venueTicker} + ${DEPTH_URL}?symbol=${market.venueTicker}`
      };
    })
  );
}
