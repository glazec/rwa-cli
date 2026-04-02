import { canonicalSymbol, inferCategory, isTradableRwaSymbol, resolveAliases, resolveAssetName } from "../lib/assets.js";
import { fetchJson, toNumber } from "../lib/http.js";
import { liquidityWithinPct, normalizeOrderBook } from "../lib/market.js";

const PAIRS_URL = "https://api.gateio.ws/api/v4/spot/currency_pairs";
const TICKERS_URL = "https://api.gateio.ws/api/v4/spot/tickers";
const ORDER_BOOK_URL = "https://api.gateio.ws/api/v4/spot/order_book";

let pairsCache = null;

function isRwaPair(pair) {
  return pair?.trade_status === "tradable" && pair?.quote === "USDT" && /ON$/i.test(pair?.base ?? "");
}

function symbolFromPairId(pairId) {
  return canonicalSymbol(String(pairId || "").split("_")[0].replace(/on$/i, ""));
}

async function fetchPairs() {
  if (pairsCache) {
    return pairsCache;
  }

  const json = await fetchJson(PAIRS_URL, { headers: { accept: "application/json" } }, 15000);
  pairsCache = Array.isArray(json) ? json : [];
  return pairsCache;
}

async function fetchTicker(pairId) {
  const json = await fetchJson(
    `${TICKERS_URL}?currency_pair=${encodeURIComponent(pairId)}`,
    { headers: { accept: "application/json" } },
    12000
  );

  return Array.isArray(json) ? json[0] ?? null : null;
}

async function fetchOrderBook(pairId) {
  const json = await fetchJson(
    `${ORDER_BOOK_URL}?currency_pair=${encodeURIComponent(pairId)}&limit=50`,
    { headers: { accept: "application/json" } },
    12000
  );

  return normalizeOrderBook(json);
}

export async function listMarkets() {
  const pairs = await fetchPairs();

  return pairs
    .filter(isRwaPair)
    .map((pair) => {
      const symbol = symbolFromPairId(pair.id);
      const name = resolveAssetName(symbol, pair.base_name);

      return {
        venue: "gate",
        venueTicker: pair.id,
        symbol,
        name,
        type: "spot",
        category: inferCategory(symbol, name),
        aliases: resolveAliases(symbol, pair.id, name),
        raw: pair
      };
    })
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const pairs = await fetchPairs();

  const matched = pairs
    .filter(isRwaPair)
    .map((pair) => {
      const symbol = symbolFromPairId(pair.id);
      const name = resolveAssetName(symbol, pair.base_name);
      return { pairId: pair.id, symbol, name };
    })
    .filter((market) => wanted.has(market.symbol))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));

  return await Promise.all(
    matched.map(async (market) => {
      const [ticker, book] = await Promise.all([
        fetchTicker(market.pairId).catch(() => null),
        fetchOrderBook(market.pairId).catch(() => null)
      ]);

      return {
        venue: "gate",
        venueTicker: market.pairId,
        symbol: market.symbol,
        name: market.name,
        type: "spot",
        price: toNumber(ticker?.last),
        bid: toNumber(ticker?.highest_bid),
        ask: toNumber(ticker?.lowest_ask),
        liquidity2Pct: book ? liquidityWithinPct(book) : null,
        volume24h: toNumber(ticker?.quote_volume),
        volume30d: null,
        openInterest: null,
        fundingRate: null,
        fundingRateApr: null,
        category: inferCategory(market.symbol, market.name),
        source: `${TICKERS_URL}?currency_pair=${market.pairId} + ${ORDER_BOOK_URL}`
      };
    })
  );
}
