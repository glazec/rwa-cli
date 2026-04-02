import { canonicalSymbol } from "../lib/assets.js";
import { compactList } from "../lib/http.js";

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export function aggregateAssets(markets) {
  const bySymbol = new Map();

  for (const market of markets) {
    const existing = bySymbol.get(market.symbol) ?? {
      symbol: market.symbol,
      name: market.name,
      category: market.category,
      entityKinds: new Set(),
      venues: new Set(),
      marketTypes: new Set(),
      tickers: [],
      aliases: new Set(),
      networks: new Set()
    };

    existing.name = existing.name || market.name;
    existing.category = existing.category || market.category;
    existing.entityKinds.add(market.entityKind ?? "asset");
    existing.venues.add(market.venue);
    existing.marketTypes.add(market.type);
    existing.tickers.push(`${market.venue}:${market.venueTicker}`);
    for (const alias of market.aliases ?? []) {
      existing.aliases.add(alias);
    }
    for (const network of market.supportedNetworks ?? []) {
      existing.networks.add(network.network);
    }

    bySymbol.set(market.symbol, existing);
  }

  return [...bySymbol.values()]
    .map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      category: asset.category,
      entityKinds: [...asset.entityKinds].sort(),
      venues: [...asset.venues].sort(),
      marketTypes: [...asset.marketTypes].sort(),
      tickers: compactList(asset.tickers).sort(),
      aliases: [...asset.aliases],
      networks: [...asset.networks].sort()
    }))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function findMatchingAssets(assets, query) {
  const normalizedQuery = normalizeText(query);
  const exact = findExactMatchingAssets(assets, query);

  if (exact.length > 0) {
    return exact;
  }

  return assets.filter((asset) => {
    if (normalizeText(asset.symbol).includes(normalizedQuery)) {
      return true;
    }

    if (normalizeText(asset.name).includes(normalizedQuery)) {
      return true;
    }

    return asset.aliases.some((alias) => normalizeText(alias).includes(normalizedQuery));
  });
}

export function findExactMatchingAssets(assets, query) {
  const normalizedQuery = normalizeText(query);
  const canonicalQuery = canonicalSymbol(query);

  return assets.filter((asset) => {
    if (asset.symbol === canonicalQuery) {
      return true;
    }

    return asset.aliases.some((alias) => normalizeText(alias) === normalizedQuery);
  });
}
