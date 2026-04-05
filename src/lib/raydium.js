import { getOrSetCachedJson, slippageCacheTtlMs } from "./cache.js";
import { fetchJson, toNumber } from "./http.js";

export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RAYDIUM_SWAP_HOST = "https://transaction-v1.raydium.io";
const DEFAULT_SLIPPAGE_BPS = 50;
const DEFAULT_MAX_PRICE_IMPACT_PCT = 2;
const DEFAULT_BASE_AMOUNT = 1_000_000n;
const DEFAULT_MAX_EXPANSIONS = 18;
const DEFAULT_MAX_BINARY_STEPS = 14;
const USDC_DECIMALS = 6;

function buildQuoteUrl(inputMint, outputMint, amountRaw, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountRaw.toString(),
    slippageBps: String(slippageBps),
    txVersion: "V0"
  });

  return `${RAYDIUM_SWAP_HOST}/compute/swap-base-in?${params.toString()}`;
}

export async function fetchRaydiumQuote(inputMint, outputMint, amountRaw, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  const json = await fetchJson(buildQuoteUrl(inputMint, outputMint, amountRaw, slippageBps), {}, 15000);
  if (!json?.success || !json?.data?.outputAmount) {
    return null;
  }

  return {
    inputMint: json.data.inputMint,
    inputAmount: BigInt(json.data.inputAmount),
    outputMint: json.data.outputMint,
    outputAmount: BigInt(json.data.outputAmount),
    priceImpactPct: toNumber(json.data.priceImpactPct) ?? null,
    routePlan: json.data.routePlan ?? []
  };
}

function usdFromOutputAmount(outputAmountRaw) {
  return Number(outputAmountRaw) / 10 ** USDC_DECIMALS;
}

function isWithinImpact(quote, maxPriceImpactPct) {
  return (quote?.priceImpactPct ?? Number.POSITIVE_INFINITY) <= maxPriceImpactPct;
}

export async function estimateRaydiumExitLiquidityUsd(
  inputMint,
  {
    outputMint = SOLANA_USDC_MINT,
    maxPriceImpactPct = DEFAULT_MAX_PRICE_IMPACT_PCT
  } = {}
) {
  if (!inputMint) {
    return null;
  }

  const cacheKey = [
    "slippage",
    "raydium",
    "sell",
    inputMint,
    "buy",
    outputMint,
    "impact",
    String(maxPriceImpactPct).replace(/[^a-zA-Z0-9._-]+/g, "_")
  ].join("-");

  return await getOrSetCachedJson(
    cacheKey,
    async () => {
      let bestQuote = await fetchRaydiumQuote(inputMint, outputMint, DEFAULT_BASE_AMOUNT);
      if (!bestQuote) {
        return null;
      }

      if (!isWithinImpact(bestQuote, maxPriceImpactPct)) {
        return {
          liquidityUsd: usdFromOutputAmount(bestQuote.outputAmount),
          inputAmountRaw: bestQuote.inputAmount.toString(),
          outputAmountRaw: bestQuote.outputAmount.toString(),
          priceImpactPct: bestQuote.priceImpactPct,
          routePlanLength: bestQuote.routePlan.length
        };
      }

      let low = bestQuote.inputAmount;
      let high = bestQuote.inputAmount;
      let upperQuote = null;

      for (let index = 0; index < DEFAULT_MAX_EXPANSIONS; index += 1) {
        const candidateAmount = high * 2n;
        const candidateQuote = await fetchRaydiumQuote(inputMint, outputMint, candidateAmount);

        if (!candidateQuote) {
          break;
        }

        if (isWithinImpact(candidateQuote, maxPriceImpactPct)) {
          low = candidateQuote.inputAmount;
          high = candidateQuote.inputAmount;
          bestQuote = candidateQuote;
          continue;
        }

        high = candidateQuote.inputAmount;
        upperQuote = candidateQuote;
        break;
      }

      if (!upperQuote) {
        return {
          liquidityUsd: usdFromOutputAmount(bestQuote.outputAmount),
          inputAmountRaw: bestQuote.inputAmount.toString(),
          outputAmountRaw: bestQuote.outputAmount.toString(),
          priceImpactPct: bestQuote.priceImpactPct,
          routePlanLength: bestQuote.routePlan.length
        };
      }

      for (let index = 0; index < DEFAULT_MAX_BINARY_STEPS && low + 1n < high; index += 1) {
        const mid = (low + high) / 2n;
        const candidateQuote = await fetchRaydiumQuote(inputMint, outputMint, mid);

        if (!candidateQuote) {
          break;
        }

        if (isWithinImpact(candidateQuote, maxPriceImpactPct)) {
          low = candidateQuote.inputAmount;
          bestQuote = candidateQuote;
        } else {
          high = candidateQuote.inputAmount;
        }
      }

      return {
        liquidityUsd: usdFromOutputAmount(bestQuote.outputAmount),
        inputAmountRaw: bestQuote.inputAmount.toString(),
        outputAmountRaw: bestQuote.outputAmount.toString(),
        priceImpactPct: bestQuote.priceImpactPct,
        routePlanLength: bestQuote.routePlan.length
      };
    },
    slippageCacheTtlMs()
  );
}
