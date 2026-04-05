import { getOrSetCachedJson, slippageCacheTtlMs } from "./cache.js";
import { getSetting } from "./config.js";
import { toNumber } from "./http.js";

export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUPITER_QUOTE_URL = "https://api.jup.ag/swap/v1/quote";
const DEFAULT_SLIPPAGE_BPS = 50;
const DEFAULT_MAX_PRICE_IMPACT_PCT = 2;
const DEFAULT_BASE_AMOUNT = 1_000_000n;
const DEFAULT_MAX_EXPANSIONS = 18;
const DEFAULT_MAX_BINARY_STEPS = 14;
const USDC_DECIMALS = 6;

function jupiterApiKey() {
  return getSetting("JUPITER_API_KEY");
}

function buildQuoteUrl(inputMint, outputMint, amountRaw, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountRaw.toString(),
    slippageBps: String(slippageBps),
    restrictIntermediateTokens: "true",
    instructionVersion: "V2"
  });

  return `${JUPITER_QUOTE_URL}?${params.toString()}`;
}

function normalizePriceImpactPct(rawValue) {
  const parsed = toNumber(rawValue);
  if (parsed === null) {
    return null;
  }

  return parsed * 100;
}

export async function fetchJupiterQuote(inputMint, outputMint, amountRaw, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  const apiKey = jupiterApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(buildQuoteUrl(inputMint, outputMint, amountRaw, slippageBps), {
      signal: controller.signal,
      headers: {
        "user-agent": "rwa-cli/0.1.0",
        ...(apiKey ? { "x-api-key": apiKey } : {})
      }
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.outAmount) {
      return null;
    }

    return {
      inputMint: json.inputMint,
      inputAmount: BigInt(json.inAmount),
      outputMint: json.outputMint,
      outputAmount: BigInt(json.outAmount),
      priceImpactPct: normalizePriceImpactPct(json.priceImpactPct),
      routePlan: json.routePlan ?? [],
      swapUsdValue: toNumber(json.swapUsdValue)
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function usdFromOutputAmount(outputAmountRaw) {
  return Number(outputAmountRaw) / 10 ** USDC_DECIMALS;
}

function isWithinImpact(quote, maxPriceImpactPct) {
  return (quote?.priceImpactPct ?? Number.POSITIVE_INFINITY) <= maxPriceImpactPct;
}

export async function estimateJupiterExitLiquidityUsd(
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
    "jupiter",
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
      let bestQuote = await fetchJupiterQuote(inputMint, outputMint, DEFAULT_BASE_AMOUNT);
      if (!bestQuote) {
        return null;
      }

      if (!isWithinImpact(bestQuote, maxPriceImpactPct)) {
        return {
          liquidityUsd: usdFromOutputAmount(bestQuote.outputAmount),
          inputAmountRaw: bestQuote.inputAmount.toString(),
          outputAmountRaw: bestQuote.outputAmount.toString(),
          priceImpactPct: bestQuote.priceImpactPct,
          routePlanLength: bestQuote.routePlan.length,
          swapUsdValue: bestQuote.swapUsdValue
        };
      }

      let low = bestQuote.inputAmount;
      let high = bestQuote.inputAmount;
      let upperQuote = null;

      for (let index = 0; index < DEFAULT_MAX_EXPANSIONS; index += 1) {
        const candidateAmount = high * 2n;
        const candidateQuote = await fetchJupiterQuote(inputMint, outputMint, candidateAmount);

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
          routePlanLength: bestQuote.routePlan.length,
          swapUsdValue: bestQuote.swapUsdValue
        };
      }

      for (let index = 0; index < DEFAULT_MAX_BINARY_STEPS && low + 1n < high; index += 1) {
        const mid = (low + high) / 2n;
        const candidateQuote = await fetchJupiterQuote(inputMint, outputMint, mid);

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
        routePlanLength: bestQuote.routePlan.length,
        swapUsdValue: bestQuote.swapUsdValue
      };
    },
    slippageCacheTtlMs()
  );
}
