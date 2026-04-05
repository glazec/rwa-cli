import { canonicalSymbol, inferCategory, isKnownAsset, isTradableRwaSymbol, resolveAliases, resolveAssetName } from "../lib/assets.js";
import { fetchJson, toNumber } from "../lib/http.js";
import { liquidityWithinPct, normalizeOrderBook } from "../lib/market.js";

const SYMBOLS_URL = "https://www.xt.com/sapi/v4/market/public/symbol";
const TICKER_URL = "https://www.xt.com/sapi/v4/market/public/ticker/24h";
const DEPTH_URL = "https://www.xt.com/sapi/v4/market/public/depth";

let symbolsCache = null;

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
  symbolsCache = (json?.result?.symbols ?? []).map((entry) => entry.symbol);
  return symbolsCache;
}

async function fetchTicker(venueTicker) {
  const json = await fetchJson(
    `${TICKER_URL}?symbol=${encodeURIComponent(venueTicker)}`,
    { headers: { accept: "application/json" } },
    12000
  );

  return Array.isArray(json?.result) ? json.result[0] ?? null : null;
}

async function fetchDepth(venueTicker) {
  const json = await fetchJson(
    `${DEPTH_URL}?symbol=${encodeURIComponent(venueTicker)}&limit=50`,
    { headers: { accept: "application/json" } },
    12000
  );

  return normalizeOrderBook(json?.result);
}

function toMarket(venueTicker) {
  const symbol = normalizeVenueSymbol(venueTicker);
  const name = resolveAssetName(symbol);

  return {
    venue: "xt",
    venueTicker,
    symbol,
    name,
    type: "spot",
    category: inferCategory(symbol, name),
    aliases: resolveAliases(symbol, venueTicker, name),
    raw: { venueTicker }
  };
}

export async function listMarkets() {
  const symbols = await fetchSymbols();

  return symbols
    .filter(isRwaSymbol)
    .map((venueTicker) => toMarket(venueTicker))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const venueTickers = (await fetchSymbols()).filter(isRwaSymbol);

  const matched = venueTickers
    .map((venueTicker) => toMarket(venueTicker))
    .filter((market) => wanted.has(market.symbol))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));

  return await Promise.all(
    matched.map(async (market) => {
      const [ticker, book] = await Promise.all([
        fetchTicker(market.venueTicker).catch(() => null),
        fetchDepth(market.venueTicker).catch(() => null)
      ]);

      return {
        venue: "xt",
        venueTicker: market.venueTicker,
        symbol: market.symbol,
        name: market.name,
        type: "spot",
        price: toNumber(ticker?.c),
        bid: toNumber(ticker?.bp ?? book?.bids?.[0]?.price),
        ask: toNumber(ticker?.ap ?? book?.asks?.[0]?.price),
        liquidity2Pct: book ? liquidityWithinPct(book) : null,
        volume24h: toNumber(ticker?.v),
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
