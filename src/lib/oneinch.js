import { getOrSetCachedJson, slippageCacheTtlMs } from "./cache.js";
import { getSetting } from "./config.js";
import { normalizeNetworkKey } from "./networks.js";
import { runRateLimited } from "./rate-limit.js";

const ONEINCH_BASE_URL = "https://api.1inch.dev/swap/v6.1";
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
  base: {
    chainId: 8453,
    quoteTokens: [
      {
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6,
        symbol: "USDC"
      }
    ]
  },
  arbitrum: {
    chainId: 42161,
    quoteTokens: [
      {
        address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        decimals: 6,
        symbol: "USDC"
      },
      {
        address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
        decimals: 6,
        symbol: "USDT"
      }
    ]
  },
  optimism: {
    chainId: 10,
    quoteTokens: [
      {
        address: "0x0b2C639c533813f4Aa9D7837CaF62653d097Ff85",
        decimals: 6,
        symbol: "USDC"
      }
    ]
  },
  polygon: {
    chainId: 137,
    quoteTokens: [
      {
        address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
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

function oneInchApiKey() {
  return getSetting("ONEINCH_API_KEY");
}

function oneInchConfigForNetwork(network) {
  return CHAIN_CONFIG[normalizeNetworkKey(network)] ?? null;
}

async function fetchOneInchQuote(chainId, src, dst, amountRaw) {
  const apiKey = oneInchApiKey();
  if (!apiKey) {
    return null;
  }

  const url = new URL(`${ONEINCH_BASE_URL}/${chainId}/quote`);
  url.searchParams.set("src", src);
  url.searchParams.set("dst", dst);
  url.searchParams.set("amount", amountRaw.toString());

  try {
    return await runRateLimited("oneinch", async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
            "user-agent": "rwa-cli/0.1.0"
          }
        });

        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.dstAmount) {
          return null;
        }

        return {
          outputAmountRaw: BigInt(json.dstAmount)
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

function quotedPrice(outputAmountRaw, inputAmountRaw, outputDecimals, inputDecimals) {
  if (!outputAmountRaw || !inputAmountRaw) {
    return null;
  }

  const inputUnits = Number(inputAmountRaw) / 10 ** inputDecimals;
  const outputUnits = Number(outputAmountRaw) / 10 ** outputDecimals;
  if (!Number.isFinite(inputUnits) || !Number.isFinite(outputUnits) || inputUnits <= 0 || outputUnits <= 0) {
    return null;
  }

  return outputUnits / inputUnits;
}

function impactFromBaseline(baselinePrice, candidatePrice) {
  if (!Number.isFinite(baselinePrice) || baselinePrice <= 0 || !Number.isFinite(candidatePrice) || candidatePrice <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  const ratio = candidatePrice / baselinePrice;
  return Math.max(0, (1 - ratio) * 100);
}

export async function estimateOneInchExitLiquidityUsd(
  tokenAddress,
  {
    network = "ethereum",
    decimals = 18,
    maxPriceImpactPct = DEFAULT_MAX_PRICE_IMPACT_PCT
  } = {}
) {
  const config = oneInchConfigForNetwork(network);
  const apiKey = oneInchApiKey();
  if (!tokenAddress || !config || !apiKey || !Number.isFinite(decimals) || decimals < 0) {
    return null;
  }

  const unit = 10n ** BigInt(decimals);
  const baselineAmount = unit >= 100n ? unit / 100n : 1n;
  const baseAmount = unit * DEFAULT_BASE_TOKEN_UNITS;
  const cacheKey = [
    "slippage",
    "oneinch",
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
          const quote = await fetchOneInchQuote(config.chainId, tokenAddress, quoteToken.address, amountRaw);
          if (quote) {
            return {
              quoteToken,
              ...quote
            };
          }
        }

        return null;
      };

      const baselineQuote = await quoteForAmount(baselineAmount);
      if (!baselineQuote) {
        return null;
      }

      const baselinePrice = quotedPrice(
        baselineQuote.outputAmountRaw,
        baselineAmount,
        baselineQuote.quoteToken.decimals,
        decimals
      );
      if (!Number.isFinite(baselinePrice) || baselinePrice <= 0) {
        return null;
      }

      let bestQuote = null;
      let lowerBound = 0n;
      let upperBound = baseAmount;

      const firstQuote = await quoteForAmount(baseAmount);
      if (!firstQuote) {
        return null;
      }

      const firstImpactPct = impactFromBaseline(
        baselinePrice,
        quotedPrice(firstQuote.outputAmountRaw, baseAmount, firstQuote.quoteToken.decimals, decimals)
      );

      if (firstImpactPct <= maxPriceImpactPct) {
        bestQuote = {
          ...firstQuote,
          priceImpactPct: firstImpactPct
        };
        lowerBound = baseAmount;
        upperBound = baseAmount;

        for (let index = 0; index < DEFAULT_MAX_EXPANSIONS; index += 1) {
          const candidateAmount = upperBound * 2n;
          const candidateQuote = await quoteForAmount(candidateAmount);
          if (!candidateQuote) {
            break;
          }

          const candidateImpactPct = impactFromBaseline(
            baselinePrice,
            quotedPrice(candidateQuote.outputAmountRaw, candidateAmount, candidateQuote.quoteToken.decimals, decimals)
          );

          if (candidateImpactPct <= maxPriceImpactPct) {
            bestQuote = {
              ...candidateQuote,
              priceImpactPct: candidateImpactPct
            };
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

          const candidateImpactPct = impactFromBaseline(
            baselinePrice,
            quotedPrice(candidateQuote.outputAmountRaw, candidateAmount, candidateQuote.quoteToken.decimals, decimals)
          );

          if (candidateImpactPct <= maxPriceImpactPct) {
            bestQuote = {
              ...candidateQuote,
              priceImpactPct: candidateImpactPct
            };
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

        const candidateImpactPct = impactFromBaseline(
          baselinePrice,
          quotedPrice(candidateQuote.outputAmountRaw, mid, candidateQuote.quoteToken.decimals, decimals)
        );

        if (candidateImpactPct <= maxPriceImpactPct) {
          bestQuote = {
            ...candidateQuote,
            priceImpactPct: candidateImpactPct
          };
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
