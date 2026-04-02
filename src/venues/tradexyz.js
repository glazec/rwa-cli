import { fetchJson, toNumber } from "../lib/http.js";
import { annualizeFunding, liquidityWithinPct } from "../lib/market.js";
import {
  canonicalSymbol,
  inferCategory,
  isKnownAsset,
  isTradableRwaSymbol,
  resolveAliases,
  resolveAssetName
} from "../lib/assets.js";

const URL = "https://api.hyperliquid.xyz/info";

function normalizeTradeSymbol(rawSymbol) {
  const stripped = String(rawSymbol ?? "").replace(/^xyz:/, "");
  return canonicalSymbol(stripped);
}

async function fetchUniverse() {
  return fetchJson(
    URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ type: "metaAndAssetCtxs", dex: "xyz" })
    },
    12000
  );
}

export async function listMarkets() {
  const json = await fetchUniverse();
  const universe = json?.[0]?.universe ?? [];

  return universe
    .map((entry) => {
      const venueTicker = String(entry.name ?? entry.coin ?? "");
      const symbol = normalizeTradeSymbol(venueTicker);
      const name = resolveAssetName(symbol);

      return {
        venue: "trade.xyz",
        venueTicker,
        symbol,
        name,
        type: "perp",
        category: inferCategory(symbol, name),
        aliases: resolveAliases(symbol, venueTicker, name),
        raw: entry
      };
    })
    .filter((market) => isKnownAsset(market.symbol))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

async function fetchL2Book(venueTicker) {
  const json = await fetchJson(
    URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ type: "l2Book", coin: venueTicker })
    },
    12000
  );

  return {
    bids: (json?.levels?.[0] ?? []).map((level) => ({
      price: Number(level.px),
      size: Number(level.sz)
    })),
    asks: (json?.levels?.[1] ?? []).map((level) => ({
      price: Number(level.px),
      size: Number(level.sz)
    }))
  };
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const json = await fetchUniverse();
  const universe = json?.[0]?.universe ?? [];
  const ctxs = json?.[1] ?? [];

  const matched = universe
    .map((entry, index) => {
      const venueTicker = String(entry.name ?? entry.coin ?? "");
      const symbol = normalizeTradeSymbol(venueTicker);
      const ctx = ctxs[index] ?? {};
      const name = resolveAssetName(symbol);

      return {
        venueTicker,
        symbol,
        name,
        ctx
      };
    })
    .filter((market) => wanted.has(market.symbol))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));

  const books = new Map(
    await Promise.all(
      matched.map(async (market) => {
        try {
          return [market.venueTicker, await fetchL2Book(market.venueTicker)];
        } catch {
          return [market.venueTicker, null];
        }
      })
    )
  );

  return matched.map((market) => {
    const book = books.get(market.venueTicker);
    const bid = book?.bids?.[0]?.price ?? null;
    const ask = book?.asks?.[0]?.price ?? null;
    const fundingRate = toNumber(market.ctx.funding);
    const markPrice = toNumber(market.ctx.markPx);
    const openInterestBase = toNumber(market.ctx.openInterest);
    const oraclePrice = toNumber(market.ctx.oraclePx) ?? markPrice;

    return {
      venue: "trade.xyz",
      venueTicker: market.venueTicker,
      symbol: market.symbol,
      name: market.name,
      type: "perp",
      price: markPrice,
      bid,
      ask,
      liquidity2Pct: book ? liquidityWithinPct(book) : null,
      volume24h: toNumber(market.ctx.dayNtlVlm),
      openInterest:
        openInterestBase !== null && oraclePrice !== null ? openInterestBase * oraclePrice : null,
      fundingRate: fundingRate !== null ? fundingRate * 100 : null,
      fundingRateApr: fundingRate !== null ? annualizeFunding(fundingRate, 1) : null,
      category: inferCategory(market.symbol, market.name),
      source: `${URL} metaAndAssetCtxs + l2Book`
    };
  });
}
