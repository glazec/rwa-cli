import { toNumber } from "./http.js";

export function optionalNumber(value) {
  return value === null || value === undefined || value === "" ? null : toNumber(value);
}

export function sumMetric(rows, field) {
  const total = (rows ?? []).reduce((sum, row) => sum + (row?.[field] ?? 0), 0);
  return total || null;
}

export function maxMetric(rows, field) {
  const values = (rows ?? [])
    .map((row) => row?.[field] ?? null)
    .filter((value) => value !== null && value !== undefined);

  if (values.length === 0) {
    return null;
  }

  return Math.max(...values);
}

export function sortNetworkRows(rows = []) {
  return [...rows].sort((left, right) => {
    const liquidityDelta = (right.liquidityUsd ?? 0) - (left.liquidityUsd ?? 0);
    if (liquidityDelta !== 0) {
      return liquidityDelta;
    }

    const liq2PctDelta = (right.liquidity2Pct ?? 0) - (left.liquidity2Pct ?? 0);
    if (liq2PctDelta !== 0) {
      return liq2PctDelta;
    }

    return (right.volume24h ?? 0) - (left.volume24h ?? 0);
  });
}
