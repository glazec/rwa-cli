import { canonicalSymbol, inferCategory, isKnownAsset, isTradableRwaSymbol, resolveAliases, resolveAssetName } from "../lib/assets.js";
import { fetchJson, toNumber } from "../lib/http.js";
import { liquidityWithinPct, normalizeOrderBook } from "../lib/market.js";

const INSTRUMENTS_URL = "https://api.bybit.com/v5/market/instruments-info";
const TICKER_URL = "https://api.bybit.com/v5/market/tickers";
const ORDERBOOK_URL = "https://api.bybit.com/v5/market/orderbook";

let symbolsCache = null;

function baseSymbolFromTicker(venueTicker) {
  return String(venueTicker || "")
    .trim()
    .toUpperCase()
    .replace(/USDT$/i, "");
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
  if (!base || !String(venueTicker || "").toUpperCase().endsWith("USDT")) {
    return false;
  }

  if (["XAUT", "PAXG"].includes(base)) {
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

  const rows = [];
  let cursor = null;
  const seenCursors = new Set();

  do {
    const query = new URLSearchParams({
      category: "spot",
      limit: "1000"
    });

    if (cursor) {
      query.set("cursor", cursor);
    }

    const json = await fetchJson(`${INSTRUMENTS_URL}?${query.toString()}`, { headers: { accept: "application/json" } }, 15000);
    const result = json?.result ?? {};

    rows.push(...(result.list ?? []));

    const nextCursor = result.nextPageCursor || null;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      cursor = null;
    } else {
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
  } while (cursor);

  symbolsCache = rows;
  return symbolsCache;
}

async function fetchTicker(venueTicker) {
  const query = new URLSearchParams({
    category: "spot",
    symbol: venueTicker
  });

  const json = await fetchJson(`${TICKER_URL}?${query.toString()}`, { headers: { accept: "application/json" } }, 12000);
  return json?.result?.list?.[0] ?? null;
}

async function fetchOrderBook(venueTicker) {
  const query = new URLSearchParams({
    category: "spot",
    symbol: venueTicker,
    limit: "50"
  });

  const json = await fetchJson(`${ORDERBOOK_URL}?${query.toString()}`, { headers: { accept: "application/json" } }, 12000);
  return normalizeOrderBook({
    bids: json?.result?.b ?? [],
    asks: json?.result?.a ?? []
  });
}

function toMarket(entry) {
  const symbol = normalizeVenueSymbol(entry.symbol);
  const name = resolveAssetName(symbol) || entry.baseCoin;

  return {
    venue: "bybit",
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
    .filter((entry) => entry.quoteCoin === "USDT")
    .filter((entry) => entry.status === "Trading")
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
        venue: "bybit",
        venueTicker: market.venueTicker,
        symbol: market.symbol,
        name: market.name,
        type: "spot",
        price: toNumber(ticker?.lastPrice),
        bid: toNumber(ticker?.bid1Price ?? book?.bids?.[0]?.price),
        ask: toNumber(ticker?.ask1Price ?? book?.asks?.[0]?.price),
        liquidity2Pct: book ? liquidityWithinPct(book) : null,
        volume24h: toNumber(ticker?.turnover24h ?? ticker?.volume24h),
        volume30d: null,
        openInterest: null,
        fundingRate: null,
        fundingRateApr: null,
        category: inferCategory(market.symbol, market.name),
        source: `${TICKER_URL}?category=spot&symbol=${market.venueTicker} + ${ORDERBOOK_URL}?category=spot&symbol=${market.venueTicker}`
      };
    })
  );
}
