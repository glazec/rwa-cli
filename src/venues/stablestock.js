import { fetchJson, toNumber } from "../lib/http.js";
import {
  canonicalSymbol,
  inferCategory,
  isTradableRwaSymbol,
  resolveAliases,
  resolveAssetName
} from "../lib/assets.js";

const URL = "https://app.stablestock.finance/web/stocks/list";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

async function fetchPage(page) {
  const json = await fetchJson(
    URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "device-id": "rwa-cli",
        lang: "en-US"
      },
      body: JSON.stringify({
        search_name: "",
        page,
        page_size: PAGE_SIZE,
        market: 1
      })
    },
    12000
  );

  return json?.data ?? {};
}

async function fetchStocks() {
  const firstPage = await fetchPage(1);
  const pageCount = Math.min(toNumber(firstPage.page_count) ?? 1, MAX_PAGES);
  const pages = [firstPage];

  if (pageCount > 1) {
    const trailingPages = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, index) =>
        fetchPage(index + 2).catch(() => ({}))
      )
    );
    pages.push(...trailingPages);
  }

  return pages.flatMap((page) => page.list ?? []);
}

export async function listMarkets() {
  const stocks = await fetchStocks();

  return stocks
    .map((stock) => {
      const venueTicker = `s${String(stock.stock_code ?? "").toUpperCase()}`;
      const symbol = canonicalSymbol(stock.stock_code);
      const name = resolveAssetName(symbol, stock.stock_name);

      return {
        venue: "stablestock",
        venueTicker,
        symbol,
        name,
        type: "spot",
        category: inferCategory(symbol, name),
        aliases: resolveAliases(symbol, venueTicker, name),
        raw: stock
      };
    })
    .filter((market) => market.symbol)
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const stocks = await fetchStocks();

  return stocks
    .map((stock) => {
      const symbol = canonicalSymbol(stock.stock_code);
      const name = resolveAssetName(symbol, stock.stock_name);

      return {
        venue: "stablestock",
        venueTicker: `s${String(stock.stock_code ?? "").toUpperCase()}`,
        symbol,
        name,
        type: "spot",
        price: toNumber(stock.price),
        bid: null,
        ask: null,
        liquidity2Pct: null,
        volume24h: null,
        openInterest: null,
        fundingRate: null,
        fundingRateApr: null,
        category: inferCategory(symbol, name),
        source: URL
      };
    })
    .filter((quote) => wanted.has(quote.symbol))
    .filter((quote) => isTradableRwaSymbol(quote.symbol, quote.name));
}
