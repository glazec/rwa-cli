import { EXCLUDED_SYMBOLS, MANUAL_ASSETS, NORMALIZED_SYMBOL_ALIASES } from "../data/assets.js";

export function canonicalSymbol(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  return NORMALIZED_SYMBOL_ALIASES[normalized] ?? normalized;
}

export function inferCategory(symbol, name = "") {
  const canonical = canonicalSymbol(symbol);
  const manual = MANUAL_ASSETS[canonical];

  if (manual?.category) {
    return manual.category;
  }

  const upperName = name.toUpperCase();

  if (canonical.endsWith("USD") && canonical.length >= 6) {
    return "fx";
  }

  if (upperName.includes("ETF") || upperName.includes("TRUST") || upperName.includes("FUND")) {
    return "etf";
  }

  if (upperName.includes("INDEX")) {
    return "index";
  }

  return "equity";
}

export function resolveAssetName(symbol, name) {
  const canonical = canonicalSymbol(symbol);
  return name || MANUAL_ASSETS[canonical]?.name || canonical;
}

export function resolveAliases(symbol, venueTicker, name) {
  const canonical = canonicalSymbol(symbol);
  const manual = MANUAL_ASSETS[canonical];
  const aliases = new Set([
    canonical,
    canonical.toLowerCase(),
    venueTicker,
    venueTicker?.toLowerCase(),
    name,
    name?.toLowerCase(),
    ...(manual?.aliases ?? [])
  ]);

  return [...aliases].filter(Boolean);
}

export function isTradableRwaSymbol(symbol, name) {
  const canonical = canonicalSymbol(symbol);

  if (!canonical || EXCLUDED_SYMBOLS.has(canonical)) {
    return false;
  }

  const category = inferCategory(canonical, name);
  return category !== "fx";
}

export function isKnownAsset(symbol) {
  return Boolean(MANUAL_ASSETS[canonicalSymbol(symbol)]);
}
