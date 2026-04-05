import { getOrSetCachedJson, slippageCacheTtlMs } from "./cache.js";
import { compactList, fetchJson, toNumber } from "./http.js";

export const STON_TON_ADDRESS = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
export const STON_USDT_ADDRESS = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const STON_BASE_URL = "https://api.ston.fi";
const DEFAULT_SLIPPAGE_TOLERANCE = 0.001;
const DEFAULT_MAX_PRICE_IMPACT_PCT = 2;
const DEFAULT_MAX_EXPANSIONS = 20;
const DEFAULT_MAX_BINARY_STEPS = 16;

function buildAssetUrl(address) {
  return `${STON_BASE_URL}/v1/assets/${address}`;
}

function buildPoolsByMarketUrl(leftAddress, rightAddress) {
  return `${STON_BASE_URL}/v1/pools/by_market/${leftAddress}/${rightAddress}`;
}

function buildSwapSimulateUrl({
  offerAddress,
  askAddress,
  units,
  slippageTolerance = DEFAULT_SLIPPAGE_TOLERANCE
}) {
  const params = new URLSearchParams({
    offer_address: offerAddress,
    ask_address: askAddress,
    units: String(units),
    slippage_tolerance: String(slippageTolerance)
  });

  return `${STON_BASE_URL}/v1/swap/simulate?${params.toString()}`;
}

export async function fetchStonAsset(address) {
  if (!address) {
    return null;
  }

  const json = await fetchJson(buildAssetUrl(address), {}, 15000).catch(() => null);
  const asset = json?.asset;
  if (!asset?.contract_address) {
    return null;
  }

  return {
    address: asset.contract_address,
    symbol: asset.symbol ?? null,
    displayName: asset.display_name ?? null,
    decimals: toNumber(asset.decimals),
    kind: asset.kind ?? null,
    priceUsd: toNumber(asset.dex_usd_price ?? asset.third_party_usd_price),
    tags: Array.isArray(asset.tags) ? asset.tags : []
  };
}

export async function fetchStonPoolsByMarket(leftAddress, rightAddress) {
  if (!leftAddress || !rightAddress) {
    return [];
  }

  const json = await fetchJson(buildPoolsByMarketUrl(leftAddress, rightAddress), {}, 15000).catch(() => null);
  const pools = Array.isArray(json?.pool_list) ? json.pool_list : [];

  return pools.map((pool) => ({
    address: pool.address ?? null,
    routerAddress: pool.router_address ?? null,
    token0Address: pool.token0_address ?? null,
    token1Address: pool.token1_address ?? null,
    reserve0: toNumber(pool.reserve0),
    reserve1: toNumber(pool.reserve1),
    liquidityUsd: toNumber(pool.lp_total_supply_usd),
    deprecated: Boolean(pool.deprecated),
    tags: Array.isArray(pool.tags) ? pool.tags : []
  }));
}

export async function fetchStonSwapSimulation({
  offerAddress,
  askAddress,
  units,
  slippageTolerance = DEFAULT_SLIPPAGE_TOLERANCE
}) {
  const json = await fetchJson(
    buildSwapSimulateUrl({ offerAddress, askAddress, units, slippageTolerance }),
    {
      method: "POST"
    },
    15000
  ).catch(() => null);

  if (!json?.ask_units || !json?.offer_units) {
    return null;
  }

  return {
    offerAddress: json.offer_address ?? offerAddress,
    askAddress: json.ask_address ?? askAddress,
    offerUnits: BigInt(json.offer_units),
    askUnits: BigInt(json.ask_units),
    minAskUnits: json.min_ask_units ? BigInt(json.min_ask_units) : null,
    recommendedMinAskUnits: json.recommended_min_ask_units ? BigInt(json.recommended_min_ask_units) : null,
    priceImpactPct: (toNumber(json.price_impact) ?? 0) * 100,
    poolAddress: json.pool_address ?? null,
    routerAddress: json.router_address ?? null,
    swapRate: toNumber(json.swap_rate),
    feeUnits: json.fee_units ? BigInt(json.fee_units) : null
  };
}

function unitsForOneToken(decimals) {
  return 10n ** BigInt(decimals);
}

function usdFromAskUnits(askUnits, askAsset) {
  if (!askAsset || askUnits === null || askUnits === undefined) {
    return null;
  }

  const decimals = askAsset.decimals ?? 0;
  const humanAmount = Number(askUnits) / 10 ** decimals;
  if (askAsset.address === STON_USDT_ADDRESS) {
    return humanAmount;
  }
  if (askAsset.priceUsd !== null) {
    return humanAmount * askAsset.priceUsd;
  }
  return null;
}

function isWithinImpact(quote, maxPriceImpactPct) {
  return (quote?.priceImpactPct ?? Number.POSITIVE_INFINITY) <= maxPriceImpactPct;
}

export async function fetchStonTonSummary(address) {
  if (!address) {
    return null;
  }

  const [asset, usdtAsset, tonAsset, usdtPools, tonPools] = await Promise.all([
    fetchStonAsset(address),
    fetchStonAsset(STON_USDT_ADDRESS),
    fetchStonAsset(STON_TON_ADDRESS),
    fetchStonPoolsByMarket(address, STON_USDT_ADDRESS),
    fetchStonPoolsByMarket(address, STON_TON_ADDRESS)
  ]);

  if (!asset) {
    return null;
  }

  const distinctPools = new Map();
  for (const pool of [...usdtPools, ...tonPools]) {
    if (pool.address) {
      distinctPools.set(pool.address, pool);
    }
  }

  const pools = [...distinctPools.values()];
  const liquidityUsd = pools.reduce((sum, pool) => sum + (pool.liquidityUsd ?? 0), 0) || null;
  const preferredAskAsset = usdtPools.length > 0 ? usdtAsset : tonPools.length > 0 ? tonAsset : null;

  return {
    address: asset.address,
    symbol: asset.symbol,
    displayName: asset.displayName,
    decimals: asset.decimals,
    priceUsd: asset.priceUsd,
    liquidityUsd,
    marketCount: pools.length,
    askAsset: preferredAskAsset,
    tags: compactList([...(asset.tags ?? []), ...pools.flatMap((pool) => pool.tags ?? [])]),
    pools
  };
}

export async function estimateStonExitLiquidityUsd(
  offerAddress,
  {
    decimals,
    askAddress = STON_USDT_ADDRESS,
    maxPriceImpactPct = DEFAULT_MAX_PRICE_IMPACT_PCT
  } = {}
) {
  if (!offerAddress || !Number.isFinite(decimals) || decimals < 0) {
    return null;
  }

  const [askAsset] = await Promise.all([fetchStonAsset(askAddress)]);
  if (!askAsset) {
    return null;
  }

  const cacheKey = [
    "slippage",
    "stonfi",
    "sell",
    offerAddress,
    "buy",
    askAddress,
    "impact",
    String(maxPriceImpactPct).replace(/[^a-zA-Z0-9._-]+/g, "_")
  ].join("-");

  return await getOrSetCachedJson(
    cacheKey,
    async () => {
      const baseAmount = unitsForOneToken(decimals);
      const quoteForAmount = async (amountRaw) =>
        await fetchStonSwapSimulation({
          offerAddress,
          askAddress,
          units: amountRaw.toString()
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
        liquidityUsd: usdFromAskUnits(bestQuote.askUnits, askAsset),
        askAddress: bestQuote.askAddress,
        askUnitsRaw: bestQuote.askUnits.toString(),
        inputAmountRaw: lowerBound.toString(),
        priceImpactPct: bestQuote.priceImpactPct,
        poolAddress: bestQuote.poolAddress,
        routerAddress: bestQuote.routerAddress,
        swapRate: bestQuote.swapRate
      };
    },
    slippageCacheTtlMs()
  );
}
