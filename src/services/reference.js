import { canonicalSymbol } from "../lib/assets.js";
import { fetchJson, toNumber } from "../lib/http.js";

const YAHOO_SYMBOL_MAP = {
  WTI: "CL=F",
  BRENTOIL: "BZ=F",
  NATGAS: "NG=F",
  XAU: "GC=F",
  XAG: "SI=F",
  XCU: "HG=F",
  XPT: "PL=F",
  XPD: "PA=F",
  CORN: "ZC=F",
  WHEAT: "ZW=F",
  SPX: "^GSPC",
  VIX: "^VIX",
  JP225: "^N225",
  KR200: "^KS200",
  KRCOMP: "^KS11",
  DXY: "DX-Y.NYB",
  SAMSUNG: "005930.KS",
  SMSN: "005930.KS",
  SKHYNIX: "000660.KS",
  HYUNDAI: "005380.KS",
  SOFTBANK: "9984.T"
};

const REFERENCE_SYMBOL_ALIASES = {
  XAUT: "XAU",
  PAXG: "XAU",
  XAUM: "XAU",
  KAU: "XAU",
  PGOLD: "XAU",
  GGBR: "XAU"
};

const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const REFERENCE_CACHE = new Map();

export function assetSymbolToYahoo(symbol) {
  const canonical = canonicalSymbol(symbol);
  const referenceSymbol = REFERENCE_SYMBOL_ALIASES[canonical] ?? canonical;
  return YAHOO_SYMBOL_MAP[referenceSymbol] ?? referenceSymbol;
}

async function fetchYahooChartPrice(symbol) {
  for (const host of YAHOO_HOSTS) {
    try {
      const json = await fetchJson(
        `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d&includePrePost=false`,
        {
          headers: {
            referer: "https://finance.yahoo.com/"
          }
        },
        12000
      );

      const result = json?.chart?.result?.[0];
      const regularMarketPrice = toNumber(result?.meta?.regularMarketPrice);
      if (regularMarketPrice !== null) {
        return regularMarketPrice;
      }

      const closes = [
        ...(result?.indicators?.quote?.[0]?.close ?? []),
        ...(result?.indicators?.adjclose?.[0]?.adjclose ?? [])
      ];

      for (let index = closes.length - 1; index >= 0; index -= 1) {
        const price = toNumber(closes[index]);
        if (price !== null) {
          return price;
        }
      }
    } catch {
      // Fall through to the next Yahoo host.
    }
  }

  return null;
}

export async function getReferencePrices(symbols) {
  const wanted = [...new Set(symbols.map((symbol) => canonicalSymbol(symbol)))];
  const entries = await Promise.all(
    wanted.map(async (symbol) => {
      if (REFERENCE_CACHE.has(symbol)) {
        return [symbol, REFERENCE_CACHE.get(symbol)];
      }

      const price = await fetchYahooChartPrice(assetSymbolToYahoo(symbol));
      REFERENCE_CACHE.set(symbol, price);
      return [symbol, price];
    })
  );

  return new Map(entries);
}
