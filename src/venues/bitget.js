import { fetchJson, toNumber } from "../lib/http.js";
import { annualizeFunding, liquidityWithinPct, normalizeOrderBook } from "../lib/market.js";
import {
  canonicalSymbol,
  inferCategory,
  isKnownAsset,
  isTradableRwaSymbol,
  resolveAliases,
  resolveAssetName
} from "../lib/assets.js";
import { fetchTokenMetadata } from "./lighter.js";
import { listMarkets as listOndoMarkets } from "./ondo.js";

const MIX_TICKERS_URL =
  "https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES";
const MIX_CONTRACTS_URL =
  "https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES";
const SPOT_TICKERS_URL = "https://api.bitget.com/api/v2/spot/market/tickers";
const SPOT_SYMBOLS_URL = "https://api.bitget.com/api/v2/spot/public/symbols";

function positiveOrNull(value) {
  return value !== null && value > 0 ? value : null;
}

async function fetchSpotListings() {
  const [symbolsJson, tickersJson] = await Promise.all([
    fetchJson(SPOT_SYMBOLS_URL),
    fetchJson(SPOT_TICKERS_URL)
  ]);

  const bySymbol = new Map((tickersJson?.data ?? []).map((item) => [item.symbol, item]));

  return (symbolsJson?.data ?? [])
    .filter((item) => String(item.symbol ?? "").endsWith("ONUSDT"))
    .map((item) => {
      const venueTicker = String(item.symbol);
      const baseCoin = String(item.baseCoin ?? "").replace(/ON$/i, "");
      const symbol = canonicalSymbol(baseCoin);
      const ticker = bySymbol.get(venueTicker);
      const name = resolveAssetName(symbol);

      return {
        venue: "bitget",
        venueTicker,
        symbol,
        name,
        type: "spot",
        category: inferCategory(symbol, name),
        aliases: resolveAliases(symbol, venueTicker, name),
        raw: ticker
      };
    })
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

async function fetchPerpListings() {
  const [contractsJson, tickersJson] = await Promise.all([
    fetchJson(MIX_CONTRACTS_URL),
    fetchJson(MIX_TICKERS_URL)
  ]);

  const bySymbol = new Map((tickersJson?.data ?? []).map((item) => [item.symbol, item]));

  return (contractsJson?.data ?? [])
    .filter((item) => String(item.symbol ?? "").endsWith("USDT"))
    .map((item) => {
      const venueTicker = String(item.symbol);
      const baseCoin = String(item.baseCoin ?? "");
      const symbol = canonicalSymbol(baseCoin);
      const name = resolveAssetName(symbol);

      return {
        venue: "bitget",
        venueTicker,
        symbol,
        name,
        type: "perp",
        category: inferCategory(symbol, name),
        aliases: resolveAliases(symbol, venueTicker, name),
        raw: {
          ...(bySymbol.get(venueTicker) ?? {}),
          contract: item
        }
      };
    })
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

async function getAllowedSymbols() {
  const [tokenMetadata, ondoMarkets] = await Promise.all([fetchTokenMetadata(), listOndoMarkets()]);
  const allowed = new Set([...tokenMetadata.keys(), ...ondoMarkets.map((market) => market.symbol)]);

  for (const symbol of [...allowed]) {
    allowed.add(canonicalSymbol(symbol));
  }

  return allowed;
}

export async function listMarkets() {
  const [spot, perps, allowed] = await Promise.all([
    fetchSpotListings(),
    fetchPerpListings(),
    getAllowedSymbols()
  ]);

  return [...spot, ...perps].filter(
    (market) => allowed.has(market.symbol) || isKnownAsset(market.symbol)
  );
}

async function fetchPerpDepth(symbol) {
  const json = await fetchJson(
    `https://api.bitget.com/api/v2/mix/market/merge-depth?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES&precision=scale0&limit=200`
  );

  return normalizeOrderBook({
    bids: json?.data?.bids ?? [],
    asks: json?.data?.asks ?? []
  });
}

async function fetchSpotDepth(symbol) {
  const json = await fetchJson(
    `https://api.bitget.com/api/v2/spot/market/orderbook?symbol=${encodeURIComponent(symbol)}&type=step0&limit=200`
  );

  return normalizeOrderBook({
    bids: json?.data?.bids ?? [],
    asks: json?.data?.asks ?? []
  });
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const listings = await listMarkets();
  const matched = listings.filter((market) => wanted.has(market.symbol));

  const depthEntries = await Promise.all(
    matched.map(async (market) => {
      try {
        const book =
          market.type === "perp"
            ? await fetchPerpDepth(market.venueTicker)
            : await fetchSpotDepth(market.venueTicker);
        return [market.venueTicker, book];
      } catch {
        return [market.venueTicker, null];
      }
    })
  );

  const depths = new Map(depthEntries);

  return matched.map((market) => {
    const ticker = market.raw ?? {};
    const contract = ticker.contract ?? {};
    const book = depths.get(market.venueTicker);
    const bid = positiveOrNull(book?.bids?.[0]?.price ?? toNumber(ticker.bidPr));
    const ask = positiveOrNull(book?.asks?.[0]?.price ?? toNumber(ticker.askPr));
    const fundingRate = toNumber(ticker.fundingRate);
    const fundingIntervalHours = toNumber(contract.fundInterval);
    const holdingAmount = toNumber(ticker.holdingAmount);
    const indexPrice = toNumber(ticker.indexPrice) ?? toNumber(ticker.lastPr);

    return {
      venue: "bitget",
      venueTicker: market.venueTicker,
      symbol: market.symbol,
      name: market.name,
      type: market.type,
      price: toNumber(ticker.lastPr),
      bid,
      ask,
      liquidity2Pct: book ? liquidityWithinPct(book) : null,
      volume24h: toNumber(
        market.type === "perp" ? ticker.quoteVolume ?? ticker.usdtVolume : ticker.quoteVolume
      ),
      openInterest:
        market.type === "perp" && holdingAmount !== null && indexPrice !== null
          ? holdingAmount * indexPrice
          : null,
      fundingRate: fundingRate !== null ? fundingRate * 100 : null,
      fundingRateApr:
        fundingRate !== null && fundingIntervalHours !== null
          ? annualizeFunding(fundingRate, fundingIntervalHours)
          : null,
      category: market.category,
      source:
        market.type === "perp"
          ? `${MIX_TICKERS_URL} + merge-depth`
          : `${SPOT_TICKERS_URL} + orderbook`
    };
  });
}
