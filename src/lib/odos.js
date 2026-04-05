import { getOrSetCachedJson, slippageCacheTtlMs } from "./cache.js";
import { getSetting } from "./config.js";
import { runRateLimited } from "./rate-limit.js";
import { toNumber } from "./http.js";
import { normalizeNetworkKey } from "./networks.js";

const ENTERPRISE_BASE_URL = "https://enterprise-api.odos.xyz";
const PUBLIC_BASE_URL = "https://api.odos.xyz";
const DEFAULT_MAX_PRICE_IMPACT_PCT = 2;
const DEFAULT_USDC_DECIMALS = 6;
const DEFAULT_BASE_TOKEN_UNITS = 1n;
const DEFAULT_MAX_EXPANSIONS = 18;
const DEFAULT_MAX_BINARY_STEPS = 16;
const DUMMY_USER = "0x0000000000000000000000000000000000010000";

const CHAIN_CONFIG = {
  ethereum: {
    chainId: 1,
    usdc: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    usdcDecimals: 6
  },
  base: {
    chainId: 8453,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    usdcDecimals: 6
  },
  arbitrum: {
    chainId: 42161,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    usdcDecimals: 6
  },
  optimism: {
    chainId: 10,
    usdc: "0x0b2C639c533813f4Aa9D7837CaF62653d097Ff85",
    usdcDecimals: 6
  },
  polygon: {
    chainId: 137,
    usdc: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    usdcDecimals: 6
  },
  bnb: {
    chainId: 56,
    usdc: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    usdcDecimals: 18
  },
  bnbchain: {
    chainId: 56,
    usdc: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    usdcDecimals: 18
  },
  bsc: {
    chainId: 56,
    usdc: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    usdcDecimals: 18
  }
};

function odosApiKey() {
  return getSetting("ODOS_API_KEY");
}

export function odosConfigForNetwork(network) {
  return CHAIN_CONFIG[normalizeNetworkKey(network)] ?? null;
}

async function fetchOdosQuote(body) {
  const apiKey = odosApiKey();
  const baseUrl = apiKey ? ENTERPRISE_BASE_URL : PUBLIC_BASE_URL;

  try {
    return await runRateLimited("odos", async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(`${baseUrl}/sor/quote/v3`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "user-agent": "rwa-cli/0.1.0",
            ...(apiKey ? { "x-api-key": apiKey } : {})
          },
          body: JSON.stringify(body)
        });

        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.outAmounts?.[0]) {
          return null;
        }

        return {
          outputAmountRaw: BigInt(json.outAmounts[0]),
          priceImpactPct: toNumber(json.priceImpact),
          gasEstimate: toNumber(json.gasEstimate),
          pathId: json.pathId ?? null
        };
      } finally {
        clearTimeout(timeout);
      }
    });
  } catch {
    return null;
  }
}

function usdFromOutputAmount(outputAmountRaw, outputDecimals = DEFAULT_USDC_DECIMALS) {
  return Number(outputAmountRaw) / 10 ** outputDecimals;
}

function isWithinImpact(quote, maxPriceImpactPct) {
  return (quote?.priceImpactPct ?? Number.POSITIVE_INFINITY) <= maxPriceImpactPct;
}

export async function estimateOdosExitLiquidityUsd(
  tokenAddress,
  {
    network = "ethereum",
    decimals = 18,
    maxPriceImpactPct = DEFAULT_MAX_PRICE_IMPACT_PCT
  } = {}
) {
  const config = odosConfigForNetwork(network);
  if (!tokenAddress || !config || !Number.isFinite(decimals) || decimals < 0) {
    return null;
  }

  const unit = 10n ** BigInt(decimals);
  const baseAmount = unit * DEFAULT_BASE_TOKEN_UNITS;
  const cacheKey = [
    "slippage",
    "odos",
    normalizeNetworkKey(network),
    tokenAddress,
    "impact",
    String(maxPriceImpactPct).replace(/[^a-zA-Z0-9._-]+/g, "_")
  ].join("-");

  return await getOrSetCachedJson(
    cacheKey,
    async () => {
      const quoteForAmount = async (amountRaw) =>
        await fetchOdosQuote({
          chainId: config.chainId,
          inputTokens: [{ tokenAddress, amount: amountRaw.toString() }],
          outputTokens: [{ tokenAddress: config.usdc, proportion: 1 }],
          userAddr: DUMMY_USER,
          slippageLimitPercent: 0.3,
          compact: true,
          simple: true
        });

      let bestQuote = null;
      let lowerBound = 0n;
      let upperBound = baseAmount;
      let firstQuote = await quoteForAmount(baseAmount);

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
          firstQuote = candidateQuote;
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
        liquidityUsd: usdFromOutputAmount(bestQuote.outputAmountRaw, config.usdcDecimals ?? DEFAULT_USDC_DECIMALS),
        outputAmountRaw: bestQuote.outputAmountRaw.toString(),
        inputAmountRaw: lowerBound.toString(),
        priceImpactPct: bestQuote.priceImpactPct,
        gasEstimate: bestQuote.gasEstimate,
        pathId: bestQuote.pathId
      };
    },
    slippageCacheTtlMs()
  );
}
