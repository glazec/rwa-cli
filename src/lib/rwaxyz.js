import { fetchText, toNumber } from "./http.js";
import { explorerBaseUrlForNetwork, networkDisplayName, normalizeNetworkKey } from "./networks.js";

const PAGE_CACHE = new Map();

function extractNextData(html, url) {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );

  if (!match) {
    throw new Error(`Could not find __NEXT_DATA__ on ${url}`);
  }

  return JSON.parse(match[1]);
}

export async function fetchNextDataPage(url) {
  if (PAGE_CACHE.has(url)) {
    return PAGE_CACHE.get(url);
  }

  const html = await fetchText(
    url,
    {
      headers: {
        referer: url
      }
    },
    15000
  );
  const data = extractNextData(html, url);
  PAGE_CACHE.set(url, data);
  return data;
}

export async function fetchRwaPlatformPage(slug) {
  const data = await fetchNextDataPage(`https://app.rwa.xyz/platforms/${slug}`);
  return data?.props?.pageProps?.platform ?? null;
}

export async function fetchXstocksProductsPage() {
  const data = await fetchNextDataPage("https://xstocks.fi/us/products");
  return data?.props?.pageProps?.products ?? [];
}

export function toRwaSupportedNetworks(networkStats = []) {
  return networkStats
    .map((entry) => {
      const name = networkDisplayName(entry.name ?? entry.slug);
      const slug = entry.slug ?? normalizeNetworkKey(name);

      return {
        network: name,
        slug,
        address: null,
        explorerUrl: explorerBaseUrlForNetwork(slug ?? name)
      };
    })
    .filter((entry) => entry.network);
}

export function toRwaNetworkBreakdown(networkStats = []) {
  return networkStats
    .map((entry) => {
      const name = networkDisplayName(entry.name ?? entry.slug);
      const slug = entry.slug ?? normalizeNetworkKey(name);

      return {
        network: name,
        slug,
        explorerUrl: explorerBaseUrlForNetwork(slug ?? name),
        volume30d: toNumber(entry.trailing_30_day_transfer_volume?.val),
        totalValue: toNumber(entry.bridged_token_value_dollar?.val),
        holders: toNumber(entry.holding_addresses_count?.val),
        activeAddresses30d: toNumber(entry.trailing_30_day_active_addresses_count?.val)
      };
    })
    .filter((entry) => entry.network);
}
