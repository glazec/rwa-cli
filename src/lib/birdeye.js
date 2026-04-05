import { fetchJson, toNumber } from "./http.js";
import { getSetting } from "./config.js";
import { normalizeNetworkKey, networkDisplayName } from "./networks.js";

const BIRDEYE_BASE_URL = "https://public-api.birdeye.so";
const UNIBLOCK_BIRDEYE_BASE_URL = "https://api.uniblock.dev/direct/v1/Birdeye";
const BIRDEYE_MIN_INTERVAL_MS = 1100;
const USD_QUOTES = new Set(["USDC", "USDT", "USD", "USD1", "USDG", "USDS", "DAI"]);
const BIRDEYE_SUPPORTED_CHAINS = new Set(["solana", "ethereum", "base", "bsc", "arbitrum", "optimism"]);
let birdeyeQueue = Promise.resolve();

function getBirdeyeApiKey() {
  return getSetting("BIRDEYE_API_KEY");
}

function getUniblockApiKey() {
  return getSetting("UNIBLOCK_API_KEY");
}

export function birdeyeChainForNetwork(network) {
  const key = normalizeNetworkKey(network);

  if (key === "bnb" || key === "bnbchain") {
    return "bsc";
  }

  if (BIRDEYE_SUPPORTED_CHAINS.has(key)) {
    return key;
  }

  return null;
}

async function fetchBirdeye(path, chain = null) {
  const birdeyeApiKey = getBirdeyeApiKey();
  const uniblockApiKey = getUniblockApiKey();
  if (!birdeyeApiKey && !uniblockApiKey) {
    return null;
  }

  const useDirectBirdeye = Boolean(birdeyeApiKey);
  const baseUrl = useDirectBirdeye ? BIRDEYE_BASE_URL : UNIBLOCK_BIRDEYE_BASE_URL;
  const apiKey = birdeyeApiKey ?? uniblockApiKey;

  const request = async () => {
    try {
      return await fetchJson(
        `${baseUrl}${path}`,
        {
          headers: {
            accept: "application/json",
            "x-api-key": apiKey,
            ...(chain ? { "x-chain": chain } : {})
          }
        },
        12000
      );
    } catch {
      return null;
    }
  };

  if (!useDirectBirdeye) {
    const first = await request();
    if (first !== null) {
      return first;
    }

    return await request();
  }

  const scheduled = birdeyeQueue.then(async () => {
    const first = await request();
    if (first !== null) {
      await new Promise((resolve) => setTimeout(resolve, BIRDEYE_MIN_INTERVAL_MS));
      return first;
    }

    await new Promise((resolve) => setTimeout(resolve, BIRDEYE_MIN_INTERVAL_MS));
    const retry = await request();
    await new Promise((resolve) => setTimeout(resolve, BIRDEYE_MIN_INTERVAL_MS));
    return retry;
  });

  birdeyeQueue = scheduled.catch(() => null);
  return await scheduled;
}

export async function fetchBirdeyeTokenMarketData(address, network = "solana") {
  const chain = birdeyeChainForNetwork(network);
  if (!address || !chain) {
    return null;
  }

  const json = await fetchBirdeye(`/defi/v3/token/market-data?address=${encodeURIComponent(address)}`, chain);
  return json?.success ? json.data ?? null : null;
}

export async function fetchBirdeyeTokenMarkets(address, network = "solana") {
  const chain = birdeyeChainForNetwork(network);
  if (!address || !chain) {
    return [];
  }

  const json = await fetchBirdeye(`/defi/v2/markets?address=${encodeURIComponent(address)}`, chain);
  const items = json?.success ? json?.data?.items ?? [] : [];
  return Array.isArray(items) ? items : [];
}

export async function fetchBirdeyeTokenExitLiquidity(address, network = "solana") {
  const chain = birdeyeChainForNetwork(network);
  if (!address || !chain) {
    return null;
  }

  const json = await fetchBirdeye(`/defi/v3/token/exit-liquidity?address=${encodeURIComponent(address)}`, chain);
  return json?.success ? json.data ?? null : null;
}

export function toBirdeyeMarkets(items = [], tokenAddress, network = "solana") {
  const normalizedToken = String(tokenAddress || "").toLowerCase();
  const networkName = networkDisplayName(network);

  return items
    .map((item) => {
      const baseAddress = String(item?.base?.address || "").toLowerCase();
      const quoteAddress = String(item?.quote?.address || "").toLowerCase();
      const side = normalizedToken && baseAddress === normalizedToken ? "base" : quoteAddress === normalizedToken ? "quote" : null;
      const isBase = side === "base";
      const quoteSymbol = String(item?.quote?.symbol || "").toUpperCase();
      const hasUsdQuote = USD_QUOTES.has(quoteSymbol);

      return {
        network: networkName,
        dex: item?.source ?? null,
        pairAddress: item?.address ?? null,
        pairUrl: item?.address ? `https://birdeye.so/pool/${item.address}?chain=${birdeyeChainForNetwork(network) ?? "solana"}` : null,
        pairLabel: item?.name ?? null,
        side,
        priceUsd: isBase && hasUsdQuote ? toNumber(item?.price) : null,
        volume24h: toNumber(item?.volume24h),
        liquidityUsd: toNumber(item?.liquidity),
        marketCap: null,
        fdv: null,
        txns24h: toNumber(item?.trade24h),
        uniqueWallet24h: toNumber(item?.uniqueWallet24h)
      };
    })
    .filter((market) => market.pairAddress);
}
