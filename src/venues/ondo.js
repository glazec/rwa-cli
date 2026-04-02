import { fetchBinanceWeb3Tokens, BINANCE_WEB3_URL } from "../lib/binance-web3.js";
import { toNumber } from "../lib/http.js";
import { canonicalSymbol, inferCategory, isTradableRwaSymbol, resolveAliases, resolveAssetName } from "../lib/assets.js";

export async function listMarkets() {
  const tokens = await fetchBinanceWeb3Tokens();

  return tokens
    .map((token) => {
      const venueTicker = String(token.symbol ?? "");
      const canonical = canonicalSymbol(venueTicker.replace(/on$/i, ""));
      const name = resolveAssetName(canonical, token.stockCompanyName ?? token.symbol);

      return {
        venue: "ondo",
        venueTicker,
        symbol: canonical,
        name,
        type: "spot",
        category: inferCategory(canonical, name),
        aliases: resolveAliases(canonical, venueTicker, name),
        raw: token
      };
    })
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const tokens = await fetchBinanceWeb3Tokens();

  return tokens
    .map((token) => {
      const venueTicker = String(token.symbol ?? "");
      const symbol = canonicalSymbol(venueTicker.replace(/on$/i, ""));
      const name = resolveAssetName(symbol, token.stockCompanyName ?? token.symbol);

      return {
        venue: "ondo",
        venueTicker,
        symbol,
        name,
        type: "spot",
        price: toNumber(token.price),
        bid: null,
        ask: null,
        liquidity2Pct: null,
        volume24h:
          (toNumber(token.volume24hBuy) ?? 0) + (toNumber(token.volume24hSell) ?? 0),
        openInterest: null,
        fundingRate: null,
        fundingRateApr: null,
        category: inferCategory(symbol, name),
        source: BINANCE_WEB3_URL
      };
    })
    .filter((quote) => wanted.has(quote.symbol))
    .filter((quote) => isTradableRwaSymbol(quote.symbol, quote.name));
}
