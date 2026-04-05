import { estimateJupiterExitLiquidityUsd } from "./jupiter.js";
import { estimateLifiExitLiquidityUsd } from "./lifi.js";
import { estimateOdosExitLiquidityUsd } from "./odos.js";
import { estimateOkxExitLiquidityUsd } from "./okx.js";
import { estimateOneInchExitLiquidityUsd } from "./oneinch.js";
import { hasSetting } from "./config.js";

export const ROUTE_LIQUIDITY_PROVIDERS = {
  jupiter_quote: estimateJupiterExitLiquidityUsd,
  lifi_quote: estimateLifiExitLiquidityUsd,
  odos_quote: estimateOdosExitLiquidityUsd,
  oneinch_quote: estimateOneInchExitLiquidityUsd,
  okx_quote: estimateOkxExitLiquidityUsd
};

export const ROUTE_LIQUIDITY_PROVIDER_REQUIREMENTS = {
  jupiter_quote: [],
  lifi_quote: [],
  odos_quote: [],
  oneinch_quote: ["ONEINCH_API_KEY"],
  okx_quote: ["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_API_PASSPHRASE"]
};

export function routeLiquidityProviderRequirements(provider) {
  return ROUTE_LIQUIDITY_PROVIDER_REQUIREMENTS[provider] ?? [];
}

export function isRouteLiquidityProviderAvailable(provider) {
  return routeLiquidityProviderRequirements(provider).every((key) => hasSetting(key));
}

export function missingRouteLiquidityProviderSettings(provider) {
  return routeLiquidityProviderRequirements(provider).filter((key) => !hasSetting(key));
}

function normalizeProvider(provider) {
  if (typeof provider === "string") {
    if (!isRouteLiquidityProviderAvailable(provider)) {
      return null;
    }
    const estimate = ROUTE_LIQUIDITY_PROVIDERS[provider];
    return estimate ? { source: provider, estimate } : null;
  }

  if (provider?.source && typeof provider?.estimate === "function") {
    return provider;
  }

  return null;
}

export async function estimatePreferredRouteLiquidity(
  tokenAddress,
  {
    network = null,
    decimals = null,
    providers = [],
    buildOptions = null
  } = {}
) {
  if (!tokenAddress) {
    return null;
  }

  const normalizedProviders = providers.map(normalizeProvider).filter(Boolean);
  if (normalizedProviders.length === 0) {
    return null;
  }

  for (const provider of normalizedProviders) {
    const options = buildOptions
      ? buildOptions({ tokenAddress, network, decimals, provider: provider.source }) ?? {}
      : { network, decimals };

    const liquidity = await provider.estimate(tokenAddress, options).catch(() => null);
    if (liquidity?.liquidityUsd) {
      return {
        provider: provider.source,
        network,
        ...liquidity
      };
    }
  }

  return null;
}

export async function estimatePreferredRouteLiquidityByNetworks(
  supportedNetworks,
  {
    prioritiesByNetwork = {},
    buildOptions = null
  } = {}
) {
  const results = [];

  for (const network of supportedNetworks ?? []) {
    if (!network?.address) {
      continue;
    }

    const providers = prioritiesByNetwork[network.slug] ?? [];
    const liquidity = await estimatePreferredRouteLiquidity(network.address, {
      network: network.slug,
      decimals: network.decimals ?? null,
      providers,
      buildOptions: buildOptions
        ? (context) => buildOptions({ ...context, networkEntry: network })
        : null
    });

    if (liquidity) {
      results.push({
        network,
        ...liquidity
      });
    }
  }

  return results;
}
