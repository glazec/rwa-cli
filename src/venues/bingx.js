import { canonicalSymbol, inferCategory, isKnownAsset, isTradableRwaSymbol, resolveAliases, resolveAssetName } from "../lib/assets.js";
import { fetchJson, toNumber } from "../lib/http.js";
import { liquidityWithinPct, normalizeOrderBook } from "../lib/market.js";

const BASE_URL = "https://open-api.bingx.com";
const SYMBOLS_URL = `${BASE_URL}/openApi/spot/v1/common/symbols`;
const TICKER_URL = `${BASE_URL}/openApi/spot/v1/ticker/24hr`;
const DEPTH_URL = `${BASE_URL}/openApi/spot/v2/market/depth`;

let symbolsCache = null;

function withTimestamp(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}timestamp=${Date.now()}`;
}

function baseSymbolFromTicker(venueTicker) {
  return String(venueTicker || "")
    .trim()
    .toUpperCase()
    .replace(/-USDT$/i, "");
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
  if (!base || !String(venueTicker || "").toUpperCase().endsWith("-USDT")) {
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

  const json = await fetchJson(withTimestamp(SYMBOLS_URL), { headers: { accept: "application/json" } }, 15000);
  symbolsCache = (json?.data?.symbols ?? []).filter((entry) => entry.status === 1);
  return symbolsCache;
}

async function fetchTicker(venueTicker) {
  const json = await fetchJson(
    withTimestamp(`${TICKER_URL}?symbol=${encodeURIComponent(venueTicker)}`),
    { headers: { accept: "application/json" } },
    12000
  );

  return Array.isArray(json?.data) ? json.data[0] ?? null : null;
}

async function fetchOrderBook(venueTicker) {
  const json = await fetchJson(
    withTimestamp(`${DEPTH_URL}?symbol=${encodeURIComponent(venueTicker)}&type=step0&limit=50`),
    { headers: { accept: "application/json" } },
    12000
  );

  return normalizeOrderBook(json?.data);
}

function toMarket(entry) {
  const symbol = normalizeVenueSymbol(entry.symbol);
  const name = resolveAssetName(symbol) || entry.displayName || entry.symbol;

  return {
    venue: "bingx",
    venueTicker: entry.symbol,
    symbol,
    name,
    type: "spot",
    category: inferCategory(symbol, name),
    aliases: resolveAliases(symbol, entry.symbol, name),
    raw: { venueTicker: entry.symbol }
  };
}

export async function listMarkets() {
  const symbols = await fetchSymbols();

  return symbols
    .filter((entry) => entry.apiStateBuy && entry.apiStateSell)
    .filter((entry) => isRwaSymbol(entry.symbol))
    .map((entry) => toMarket(entry))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const markets = (await listMarkets()).filter((market) => wanted.has(market.symbol));

  return await Promise.all(
    markets.map(async (market) => {
      const [ticker, book] = await Promise.all([
        fetchTicker(market.venueTicker).catch(() => null),
        fetchOrderBook(market.venueTicker).catch(() => null)
      ]);

      return {
        venue: "bingx",
        venueTicker: market.venueTicker,
        symbol: market.symbol,
        name: market.name,
        type: "spot",
        price: toNumber(ticker?.lastPrice),
        bid: toNumber(ticker?.bidPrice ?? book?.bids?.[0]?.price),
        ask: toNumber(ticker?.askPrice ?? book?.asks?.[0]?.price),
        liquidity2Pct: book ? liquidityWithinPct(book) : null,
        volume24h: toNumber(ticker?.quoteVolume ?? ticker?.volume),
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
