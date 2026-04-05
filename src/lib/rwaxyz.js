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

function parseXstocksExplorerAddresses(html) {
  const rows = [...html.matchAll(/<tr[^>]+id="([^"]+)"[\s\S]*?<\/tr>/g)];
  const parsed = new Map();

  for (const [, symbol, rowHtml] of rows.map((match) => [match[0], match[1], match[0]])) {
    const addresses = {};

    for (const hrefMatch of rowHtml.matchAll(/href="([^"]+)"/g)) {
      const href = hrefMatch[1];

      if (/solscan\.io\/token\//i.test(href)) {
        addresses.solana = href.split("/token/")[1] ?? addresses.solana;
      } else if (/etherscan\.io\/token\//i.test(href)) {
        addresses.ethereum = href.split("/token/")[1] ?? addresses.ethereum;
      } else if (/tonviewer\.com\/address\//i.test(href)) {
        addresses.ton = href.split("/address/")[1] ?? addresses.ton;
      } else if (/explorer\.inkonchain\.com\/token\//i.test(href)) {
        addresses.ink = href.split("/token/")[1] ?? addresses.ink;
      }
    }

    if (Object.keys(addresses).length > 0) {
      parsed.set(symbol, addresses);
    }
  }

  return parsed;
}

export async function fetchXstocksProductsPage() {
  const url = "https://xstocks.fi/us/products";
  const [data, html] = await Promise.all([fetchNextDataPage(url), fetchText(url, {}, 15000)]);
  const products = data?.props?.pageProps?.products ?? [];
  const explorerAddresses = parseXstocksExplorerAddresses(html);

  return products.map((product) => ({
    ...product,
    addresses: {
      ...(product.addresses ?? {}),
      ...(explorerAddresses.get(product.symbol) ?? {})
    }
  }));
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
        onchainMarketCap: toNumber(entry.bridged_token_market_cap_dollar?.val),
        circulatingMarketCap: toNumber(entry.circulating_asset_value_dollar?.val),
        activeAddresses30d: toNumber(entry.trailing_30_day_active_addresses_count?.val)
      };
    })
    .filter((entry) => entry.network);
}
