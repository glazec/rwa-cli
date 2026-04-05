// src/export/normalize.js

const CATEGORY_MAP = new Map([
  ["equity",    "equity"],
  ["stock",     "equity"],
  ["etf",       "etf"],
  ["commodity", "commodity"],
  ["index",     "index"],
  ["treasury",  "treasury"],
  ["real_estate", "real_estate"],
  ["issuer",    "issuer"],
  ["platform",  "platform"],
]);

export function normalizeAssetClass(rawCategory) {
  if (!rawCategory) return "unknown";
  const mapped = CATEGORY_MAP.get(rawCategory.toLowerCase());
  return mapped ?? "unknown";
}

export function normalizeEntityKind(rawKind) {
  if (rawKind === "issuer" || rawKind === "platform") return rawKind;
  return "asset";
}

export function normalizeMarketType(rawType) {
  if (rawType === "perp") return "perp";
  if (rawType === "issuer") return "issuer";
  if (rawType === "platform") return "platform";
  return "spot";
}
