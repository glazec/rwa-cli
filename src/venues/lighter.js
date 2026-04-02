import WebSocket from "ws";

import { fetchJson, toNumber } from "../lib/http.js";
import { liquidityWithinPct } from "../lib/market.js";
import {
  canonicalSymbol,
  inferCategory,
  isKnownAsset,
  isTradableRwaSymbol,
  resolveAliases,
  resolveAssetName
} from "../lib/assets.js";

const DETAILS_URL = "https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails";
const FUNDING_URL = "https://mainnet.zklighter.elliot.ai/api/v1/funding-rates";
const TOKENLIST_URL = "https://mainnet.zklighter.elliot.ai/api/v1/tokenlist";
const WS_URL = "wss://mainnet.zklighter.elliot.ai/stream";

async function fetchDetails() {
  return fetchJson(DETAILS_URL, {}, 12000);
}

async function fetchFundingRates() {
  const json = await fetchJson(FUNDING_URL);
  return json?.funding_rates ?? [];
}

export async function fetchTokenMetadata() {
  const json = await fetchJson(TOKENLIST_URL);

  return new Map(
    (json?.tokens ?? [])
      .filter((token) => token.asset_type === "RWA")
      .map((token) => [
        canonicalSymbol(token.symbol),
        {
          name: token.name,
          category: inferCategory(token.symbol, token.name)
        }
      ])
  );
}

export async function listMarkets() {
  const [details, tokenMetadata] = await Promise.all([fetchDetails(), fetchTokenMetadata()]);
  const perps = details?.order_book_details ?? [];

  return perps
    .map((entry) => {
      const symbol = canonicalSymbol(entry.symbol);
      const metadata = tokenMetadata.get(symbol);
      const name = resolveAssetName(symbol, metadata?.name);

      return {
        venue: "lighter",
        venueTicker: String(entry.symbol),
        symbol,
        name,
        type: "perp",
        category: metadata?.category ?? inferCategory(symbol, name),
        aliases: resolveAliases(symbol, entry.symbol, name),
        raw: entry
      };
    })
    .filter((market) => tokenMetadata.has(market.symbol) || isKnownAsset(market.symbol))
    .filter((market) => isTradableRwaSymbol(market.symbol, market.name));
}

function subscribeOrderBook(marketId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for lighter order book for market ${marketId}`));
    }, 8000);

    const cleanup = () => clearTimeout(timer);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "subscribe",
          channel: `order_book@tier2/${marketId}`
        })
      );
    });

    ws.on("message", (buffer) => {
      try {
        const message = JSON.parse(buffer.toString());

        if (
          message?.type === "subscribed/order_book" ||
          message?.type === "update/order_book"
        ) {
          cleanup();
          ws.close();
          resolve({
            bids: (message.order_book?.bids ?? []).map((level) => ({
              price: Number(level.price),
              size: Number(level.size)
            })),
            asks: (message.order_book?.asks ?? []).map((level) => ({
              price: Number(level.price),
              size: Number(level.size)
            }))
          });
        }
      } catch (error) {
        cleanup();
        ws.close();
        reject(error);
      }
    });

    ws.on("error", (error) => {
      cleanup();
      reject(error);
    });
  });
}

export async function getQuotes(symbols) {
  const wanted = new Set(symbols.map((symbol) => canonicalSymbol(symbol)));
  const [details, fundingRates, tokenMetadata] = await Promise.all([
    fetchDetails(),
    fetchFundingRates(),
    fetchTokenMetadata()
  ]);

  const fundingBySymbol = new Map(
    fundingRates
      .filter((entry) => entry.exchange === "lighter")
      .map((entry) => [canonicalSymbol(entry.symbol), entry])
  );

  const matched = (details?.order_book_details ?? [])
    .map((entry) => {
      const symbol = canonicalSymbol(entry.symbol);
      const metadata = tokenMetadata.get(symbol);
      const name = resolveAssetName(symbol, metadata?.name);

      return {
        symbol,
        name,
        raw: entry
      };
    })
    .filter((quote) => wanted.has(quote.symbol))
    .filter((quote) => isTradableRwaSymbol(quote.symbol, quote.name));

  const books = new Map(
    await Promise.all(
      matched.map(async (market) => {
        try {
          return [market.raw.market_id, await subscribeOrderBook(market.raw.market_id)];
        } catch {
          return [market.raw.market_id, null];
        }
      })
    )
  );

  return matched.map((market) => {
    const book = books.get(market.raw.market_id);
    const bid = book?.bids?.[0]?.price ?? null;
    const ask = book?.asks?.[0]?.price ?? null;
    const rawFunding = fundingBySymbol.get(market.symbol);
    const openInterestBase = toNumber(market.raw.open_interest);
    const lastPrice = toNumber(market.raw.last_trade_price);

    return {
      venue: "lighter",
      venueTicker: String(market.raw.symbol),
      symbol: market.symbol,
      name: market.name,
      type: "perp",
      price: lastPrice,
      bid,
      ask,
      liquidity2Pct: book ? liquidityWithinPct(book) : null,
      volume24h: toNumber(market.raw.daily_quote_token_volume),
      openInterest:
        openInterestBase !== null && lastPrice !== null ? openInterestBase * lastPrice : null,
      fundingRate: rawFunding ? toNumber(rawFunding.rate) * 100 : null,
      fundingRateApr: null,
      category: inferCategory(market.symbol, market.name),
      source: `${DETAILS_URL} + ${FUNDING_URL} + websocket`
    };
  });
}
