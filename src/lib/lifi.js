import { getOrSetCachedJson, slippageCacheTtlMs } from "./cache.js";
import { getSetting } from "./config.js";
import { runRateLimited } from "./rate-limit.js";
import { toNumber } from "./http.js";
import { normalizeNetworkKey } from "./networks.js";

const LIFI_BASE_URL = "https://li.quest/v1";
const DEFAULT_MAX_PRICE_IMPACT = 0.02;
const DEFAULT_SLIPPAGE = 0.005;
const DEFAULT_BASE_TOKEN_UNITS = 1n;
const DEFAULT_MAX_EXPANSIONS = 18;
const DEFAULT_MAX_BINARY_STEPS = 16;
const DUMMY_USER = "0x0000000000000000000000000000000000010000";

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
  }
};

function lifiApiKey() {
  return getSetting("LIFI_API_KEY");
}

function lifiConfigForNetwork(network) {
  return CHAIN_CONFIG[normalizeNetworkKey(network)] ?? null;
}

async function fetchLifiQuote({
  fromChainId,
  toChainId,
  fromToken,
  toToken,
  fromAmount,
  maxPriceImpact = DEFAULT_MAX_PRICE_IMPACT,
  slippage = DEFAULT_SLIPPAGE
}) {
  const apiKey = lifiApiKey();
  const url = new URL(`${LIFI_BASE_URL}/quote`);
  url.searchParams.set("fromChain", String(fromChainId));
  url.searchParams.set("toChain", String(toChainId));
  url.searchParams.set("fromToken", fromToken);
  url.searchParams.set("toToken", toToken);
  url.searchParams.set("fromAddress", DUMMY_USER);
  url.searchParams.set("fromAmount", String(fromAmount));
  url.searchParams.set("slippage", String(slippage));
  url.searchParams.set("maxPriceImpact", String(maxPriceImpact));

  try {
    return await runRateLimited("lifi", async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            accept: "application/json",
            "user-agent": "rwa-cli/0.1.0",
            ...(apiKey ? { "x-lifi-api-key": apiKey } : {})
          }
        });

        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.estimate?.toAmount) {
          return null;
        }

        return {
          toAmountRaw: BigInt(json.estimate.toAmount),
          toAmountMinRaw: json.estimate.toAmountMin ? BigInt(json.estimate.toAmountMin) : null,
          toAmountUsd: toNumber(json.estimate.toAmountUSD),
          fromAmountUsd: toNumber(json.estimate.fromAmountUSD),
          tool: json.tool ?? null,
          routeId: json.id ?? null
        };
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

export async function estimateLifiExitLiquidityUsd(
  tokenAddress,
  {
    network = "ethereum",
    decimals = 18,
    maxPriceImpactPct = 2
  } = {}
) {
  const config = lifiConfigForNetwork(network);
  if (!tokenAddress || !config || !Number.isFinite(decimals) || decimals < 0) {
    return null;
  }

  const unit = 10n ** BigInt(decimals);
  const baseAmount = unit * DEFAULT_BASE_TOKEN_UNITS;
  const maxPriceImpact = maxPriceImpactPct / 100;
  const cacheKey = [
    "slippage",
    "lifi",
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
          const quote = await fetchLifiQuote({
            fromChainId: config.chainId,
            toChainId: config.chainId,
            fromToken: tokenAddress,
            toToken: quoteToken.address,
            fromAmount: amountRaw.toString(),
            maxPriceImpact
          });

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

      bestQuote = firstQuote;
      lowerBound = baseAmount;
      upperBound = baseAmount;

      for (let index = 0; index < DEFAULT_MAX_EXPANSIONS; index += 1) {
        const candidateAmount = upperBound * 2n;
        const candidateQuote = await quoteForAmount(candidateAmount);

        if (!candidateQuote) {
          break;
        }

        bestQuote = candidateQuote;
        lowerBound = candidateAmount;
        upperBound = candidateAmount;
      }

      let failedUpperBound = upperBound * 2n;
      for (let index = 0; index < DEFAULT_MAX_BINARY_STEPS && lowerBound + 1n < failedUpperBound; index += 1) {
        const mid = (lowerBound + failedUpperBound) / 2n;
        const candidateQuote = await quoteForAmount(mid);

        if (!candidateQuote) {
          failedUpperBound = mid;
          continue;
        }

        bestQuote = candidateQuote;
        lowerBound = mid;
      }

      return {
        liquidityUsd:
          bestQuote.toAmountUsd ??
          usdFromOutputAmount(bestQuote.toAmountRaw, bestQuote.quoteToken.decimals),
        outputAmountRaw: bestQuote.toAmountRaw.toString(),
        inputAmountRaw: lowerBound.toString(),
        routeId: bestQuote.routeId,
        tool: bestQuote.tool,
        quoteTokenSymbol: bestQuote.quoteToken.symbol
      };
    },
    slippageCacheTtlMs()
  );
}
