import { fetchJson, toNumber } from "./http.js";

const DEXSCREENER_URL = "https://api.dexscreener.com/token-pairs/v1";

function normalizeDexChainId(value) {
  return String(value || "").trim().toLowerCase();
}

export function dexScreenerChainId(network) {
  const value = normalizeDexChainId(network);
  if (value === "ethereum" || value === "solana" || value === "ton" || value === "ink") {
    return value;
  }

  return null;
}

export async function fetchDexScreenerTokenPairs(network, address) {
  const chainId = dexScreenerChainId(network);
  if (!chainId || !address) {
    return [];
  }

  try {
    const json = await fetchJson(`${DEXSCREENER_URL}/${chainId}/${encodeURIComponent(address)}`, {}, 12000);
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

export function toDexMarket(pair, tokenAddress) {
  const normalizedToken = String(tokenAddress || "").toLowerCase();
  const baseAddress = String(pair?.baseToken?.address || "").toLowerCase();
  const quoteAddress = String(pair?.quoteToken?.address || "").toLowerCase();
  const side = normalizedToken && baseAddress === normalizedToken ? "base" : quoteAddress === normalizedToken ? "quote" : null;

  const isBase = side === "base";

  return {
    network: pair?.chainId ?? null,
    dex: pair?.dexId ?? null,
    pairAddress: pair?.pairAddress ?? null,
    pairUrl: pair?.url ?? null,
    pairLabel: pair?.baseToken?.symbol && pair?.quoteToken?.symbol
      ? `${pair.baseToken.symbol}/${pair.quoteToken.symbol}`
      : null,
    side,
    priceUsd: isBase ? toNumber(pair?.priceUsd) : null,
    volume24h: toNumber(pair?.volume?.h24),
    liquidityUsd: toNumber(pair?.liquidity?.usd),
    marketCap: isBase ? toNumber(pair?.marketCap) : null,
    fdv: isBase ? toNumber(pair?.fdv) : null,
    txns24h: pair?.txns?.h24
      ? toNumber(pair.txns.h24.buys) + toNumber(pair.txns.h24.sells)
      : null
  };
}
