import crypto from "node:crypto";

import { getOrSetCachedJson, slippageCacheTtlMs } from "./cache.js";
import { getSetting } from "./config.js";
import { normalizeNetworkKey } from "./networks.js";
import { toNumber } from "./http.js";
import { runRateLimited } from "./rate-limit.js";

const OKX_BASE_URL = "https://web3.okx.com";
const DEFAULT_MAX_PRICE_IMPACT_PCT = 2;
const DEFAULT_BASE_TOKEN_UNITS = 1n;
const DEFAULT_MAX_EXPANSIONS = 18;
const DEFAULT_MAX_BINARY_STEPS = 16;

const CHAIN_CONFIG = {
  ethereum: {
    chainId: 1,
    quoteTokens: [
      {
        address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        decimals: 6,
        symbol: "USDT"
      },
      {
        address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        decimals: 6,
        symbol: "USDC"
      }
    ]
  },
  bnb: {
    chainId: 56,
    quoteTokens: [
      {
        address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        decimals: 18,
        symbol: "USDC"
      },
      {
        address: "0x55d398326f99059fF775485246999027B3197955",
        decimals: 18,
        symbol: "USDT"
      }
    ]
  },
  bnbchain: {
    chainId: 56,
    quoteTokens: [
      {
        address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        decimals: 18,
        symbol: "USDC"
      },
      {
        address: "0x55d398326f99059fF775485246999027B3197955",
        decimals: 18,
        symbol: "USDT"
      }
    ]
  },
  bsc: {
    chainId: 56,
    quoteTokens: [
      {
        address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        decimals: 18,
        symbol: "USDC"
      },
      {
        address: "0x55d398326f99059fF775485246999027B3197955",
        decimals: 18,
        symbol: "USDT"
      }
    ]
  },
  solana: {
    chainId: 501,
    quoteTokens: []
  }
};

function okxApiKey() {
  return getSetting("OKX_API_KEY");
}

function okxSecretKey() {
  return getSetting("OKX_SECRET_KEY");
}

function okxPassphrase() {
  return getSetting("OKX_API_PASSPHRASE");
}

function okxConfigForNetwork(network) {
  return CHAIN_CONFIG[normalizeNetworkKey(network)] ?? null;
}

export function okxChainIndexForNetwork(network) {
  return okxConfigForNetwork(network)?.chainId ?? null;
}

function buildSignature(timestamp, requestPath) {
  const secret = okxSecretKey();
  if (!secret) {
    return null;
  }
  return crypto.createHmac("sha256", secret).update(`${timestamp}GET${requestPath}`).digest("base64");
}

async function fetchOkxQuote(chainId, src, dst, amountRaw) {
  const apiKey = okxApiKey();
  const passphrase = okxPassphrase();
  if (!apiKey || !passphrase) {
    return null;
  }

  const requestPath = `/api/v6/dex/aggregator/quote?chainIndex=${encodeURIComponent(chainId)}&amount=${encodeURIComponent(amountRaw.toString())}&swapMode=exactIn&fromTokenAddress=${encodeURIComponent(src)}&toTokenAddress=${encodeURIComponent(dst)}`;
  const timestamp = new Date().toISOString();
  const signature = buildSignature(timestamp, requestPath);
  if (!signature) {
    return null;
  }

  try {
    return await runRateLimited("okx", async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(`${OKX_BASE_URL}${requestPath}`, {
          signal: controller.signal,
          headers: {
            "OK-ACCESS-KEY": apiKey,
            "OK-ACCESS-SIGN": signature,
            "OK-ACCESS-TIMESTAMP": timestamp,
            "OK-ACCESS-PASSPHRASE": passphrase,
            accept: "application/json",
            "user-agent": "rwa-cli/0.1.0"
          }
        });

        const json = await response.json().catch(() => null);
        const data = Array.isArray(json?.data) ? json.data[0] : json?.data;
        if (!response.ok || json?.code !== "0" || !data) {
          return null;
        }

        const outputAmountRaw =
          data.toTokenAmount ??
          data.toAmount ??
          data.amountOut ??
          data.routerResult?.toTokenAmount ??
          null;

        if (!outputAmountRaw) {
          return null;
        }

        return {
          outputAmountRaw: BigInt(outputAmountRaw),
          priceImpactPct: Math.abs(
            toNumber(
              data.priceImpactPercentage ??
                data.priceImpactPercent ??
                data.priceImpact ??
                data.routerResult?.priceImpactPercentage
            ) ?? Number.POSITIVE_INFINITY
          )
        };
      } finally {
        clearTimeout(timeout);
      }
    });
  } catch {
    return null;
  }
}

async function fetchOkxHolderRows(chainId, tokenAddress) {
  const apiKey = okxApiKey();
  const passphrase = okxPassphrase();
  if (!apiKey || !passphrase) {
    return null;
  }

  const requestPath = `/api/v6/dex/market/token/holder?chainIndex=${encodeURIComponent(chainId)}&tokenContractAddress=${encodeURIComponent(tokenAddress)}`;
  const timestamp = new Date().toISOString();
  const signature = buildSignature(timestamp, requestPath);
  if (!signature) {
    return null;
  }

  try {
    return await runRateLimited("okx", async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(`${OKX_BASE_URL}${requestPath}`, {
          signal: controller.signal,
          headers: {
            "OK-ACCESS-KEY": apiKey,
            "OK-ACCESS-SIGN": signature,
            "OK-ACCESS-TIMESTAMP": timestamp,
            "OK-ACCESS-PASSPHRASE": passphrase,
            accept: "application/json",
            "user-agent": "rwa-cli/0.1.0"
          }
        });

        const json = await response.json().catch(() => null);
        if (!response.ok || json?.code !== "0" || !Array.isArray(json?.data)) {
          return null;
        }

        return json.data;
      } finally {
        clearTimeout(timeout);
      }
    });
  } catch {
    return null;
  }
}

function usdFromOutputAmount(outputAmountRaw, decimals) {
  return Number(outputAmountRaw) / 10 ** decimals;
}

function isWithinImpact(quote, maxPriceImpactPct) {
  const impact = quote?.priceImpactPct;
  if (!Number.isFinite(impact)) {
    return false;
  }
  return impact <= maxPriceImpactPct;
}

export async function estimateOkxExitLiquidityUsd(
  tokenAddress,
  {
    network = "ethereum",
    decimals = 18,
    maxPriceImpactPct = DEFAULT_MAX_PRICE_IMPACT_PCT
  } = {}
) {
  const config = okxConfigForNetwork(network);
  const apiKey = okxApiKey();
  const passphrase = okxPassphrase();
  if (!tokenAddress || !config || !apiKey || !passphrase || !Number.isFinite(decimals) || decimals < 0) {
    return null;
  }

  const unit = 10n ** BigInt(decimals);
  const baseAmount = unit * DEFAULT_BASE_TOKEN_UNITS;
  const cacheKey = [
    "slippage",
    "okx",
    normalizeNetworkKey(network),
    tokenAddress,
    "impact",
    String(maxPriceImpactPct).replace(/[^a-zA-Z0-9._-]+/g, "_")
  ].join("-");

  return await getOrSetCachedJson(
    cacheKey,
    async () => {
      const quoteForAmount = async (amountRaw) => {
        for (const quoteToken of config.quoteTokens) {
          const quote = await fetchOkxQuote(config.chainId, tokenAddress, quoteToken.address, amountRaw);
          if (quote) {
            return {
              quoteToken,
              ...quote
            };
          }
        }

        return null;
      };

      let bestQuote = null;
      let lowerBound = 0n;
      let upperBound = baseAmount;
      const firstQuote = await quoteForAmount(baseAmount);

      if (!firstQuote) {
        return null;
      }

      if (isWithinImpact(firstQuote, maxPriceImpactPct)) {
        bestQuote = firstQuote;
        lowerBound = baseAmount;
        upperBound = baseAmount;

        for (let index = 0; index < DEFAULT_MAX_EXPANSIONS; index += 1) {
          const candidateAmount = upperBound * 2n;
          const candidateQuote = await quoteForAmount(candidateAmount);
          if (!candidateQuote) {
            break;
          }

          if (isWithinImpact(candidateQuote, maxPriceImpactPct)) {
            bestQuote = candidateQuote;
            lowerBound = candidateAmount;
            upperBound = candidateAmount;
            continue;
          }

          upperBound = candidateAmount;
          break;
        }
      } else {
        upperBound = baseAmount;

        for (let index = 0; index < DEFAULT_MAX_EXPANSIONS && upperBound > 1n; index += 1) {
          const candidateAmount = upperBound / 2n;
          if (candidateAmount < 1n) {
            break;
          }

          const candidateQuote = await quoteForAmount(candidateAmount);
          if (!candidateQuote) {
            upperBound = candidateAmount;
            continue;
          }

          if (isWithinImpact(candidateQuote, maxPriceImpactPct)) {
            bestQuote = candidateQuote;
            lowerBound = candidateAmount;
            break;
          }

          upperBound = candidateAmount;
        }
      }

      if (!bestQuote) {
        return null;
      }

      for (let index = 0; index < DEFAULT_MAX_BINARY_STEPS && lowerBound + 1n < upperBound; index += 1) {
        const mid = (lowerBound + upperBound) / 2n;
        const candidateQuote = await quoteForAmount(mid);
        if (!candidateQuote) {
          upperBound = mid;
          continue;
        }

        if (isWithinImpact(candidateQuote, maxPriceImpactPct)) {
          bestQuote = candidateQuote;
          lowerBound = mid;
        } else {
          upperBound = mid;
        }
      }

      return {
        liquidityUsd: usdFromOutputAmount(bestQuote.outputAmountRaw, bestQuote.quoteToken.decimals),
        outputAmountRaw: bestQuote.outputAmountRaw.toString(),
        inputAmountRaw: lowerBound.toString(),
        priceImpactPct: bestQuote.priceImpactPct,
        quoteTokenSymbol: bestQuote.quoteToken.symbol
      };
    },
    slippageCacheTtlMs()
  );
}

export async function fetchOkxTopTokenHolders(
  tokenAddress,
  {
    network = "ethereum",
    limit = 10
  } = {}
) {
  const chainIndex = okxChainIndexForNetwork(network);
  const apiKey = okxApiKey();
  const passphrase = okxPassphrase();
  if (!tokenAddress || !chainIndex || !apiKey || !passphrase) {
    return [];
  }

  const cacheKey = [
    "okx",
    "holders",
    normalizeNetworkKey(network),
    String(tokenAddress).toLowerCase()
  ].join("-");

  const rows = await getOrSetCachedJson(cacheKey, async () => {
    return (await fetchOkxHolderRows(chainIndex, tokenAddress)) ?? [];
  });

  return (Array.isArray(rows) ? rows : []).slice(0, limit).map((row) => ({
    walletAddress: row?.holderWalletAddress ?? null,
    holdAmount: toNumber(row?.holdAmount),
    holdPercent: toNumber(row?.holdPercent),
    fundingSource: row?.fundingSource ?? null,
    nativeTokenBalance: toNumber(row?.nativeTokenBalance)
  }));
}
