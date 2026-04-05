import { canonicalSymbol, inferCategory, isKnownAsset, isTradableRwaSymbol, resolveAliases, resolveAssetName } from "../lib/assets.js";
import { fetchJson, toNumber } from "../lib/http.js";
import { liquidityWithinPct, normalizeOrderBook } from "../lib/market.js";

const PAIRS_URL = "https://api.lbkex.com/v2/currencyPairs.do";
const TICKER_URL = "https://api.lbkex.com/v2/ticker/24hr.do";
const DEPTH_URL = "https://api.lbkex.com/v2/depth.do";

let pairsCache = null;

function baseSymbolFromPair(pair) {
  return String(pair || "")
    .trim()
    .toUpperCase()
    .replace(/_USDT$/i, "");
}

function normalizeVenueSymbol(pair) {
  const base = baseSymbolFromPair(pair);

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

function isRwaPair(pair) {
  const base = baseSymbolFromPair(pair);
  if (!base || !String(pair || "").toLowerCase().endsWith("_usdt")) {
    return false;
  }

  if (["PAXG", "XAUT", "UGOLD"].includes(base)) {
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

async function fetchPairs() {
  if (pairsCache) {
    return pairsCache;
  }

  const json = await fetchJson(PAIRS_URL, { headers: { accept: "application/json" } }, 15000);
  pairsCache = Array.isArray(json?.data) ? json.data : [];
  return pairsCache;
}

async function fetchTicker(pair) {
  const json = await fetchJson(
    `${TICKER_URL}?symbol=${encodeURIComponent(pair)}`,
    { headers: { accept: "application/json" } },
    12000
  );

  return Array.isArray(json?.data) ? json.data[0] ?? null : null;
}

async function fetchDepth(pair) {
  const json = await fetchJson(
    `${DEPTH_URL}?symbol=${encodeURIComponent(pair)}&size=50&merge=0`,
    { headers: { accept: "application/json" } },
    12000
  );

  return normalizeOrderBook(json?.data);
}

function toMarket(pair) {
  const symbol = normalizeVenueSymbol(pair);
  const name = resolveAssetName(symbol);

  return {
    venue: "lbank",
    venueTicker: pair,
    symbol,
    name,
    type: "spot",
    category: inferCategory(symbol, name),
    aliases: resolveAliases(symbol, pair, name),
    raw: { venueTicker: pair }
  };
}

export async function listMarkets() {
  const pairs = await fetchPairs();

  return pairs
    .filter(isRwaPair)
    .map((pair) => toMarket(pair))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const pairs = await fetchPairs();

  const matched = pairs
    .filter(isRwaPair)
    .map((pair) => toMarket(pair))
    .filter((market) => wanted.has(market.symbol))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));

  return await Promise.all(
    matched.map(async (market) => {
      const [ticker, book] = await Promise.all([
        fetchTicker(market.venueTicker).catch(() => null),
        fetchDepth(market.venueTicker).catch(() => null)
      ]);

      return {
        venue: "lbank",
        venueTicker: market.venueTicker,
        symbol: market.symbol,
        name: market.name,
        type: "spot",
        price: toNumber(ticker?.ticker?.latest),
        bid: book?.bids?.[0]?.price ?? null,
        ask: book?.asks?.[0]?.price ?? null,
        liquidity2Pct: book ? liquidityWithinPct(book) : null,
        volume24h: toNumber(ticker?.ticker?.turnover),
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
