---
name: rwa-research
description: >
  Use when the user asks about tokenized real-world assets, RWA tokens, stock tokens,
  tokenized commodities (gold, silver), venue coverage, asset wrapper resolution,
  quote comparison across exchanges, onchain liquidity for RWA, or mentions specific
  venues like Dinari, Ondo, xStocks, Backed, Remora, Securitize, Superstate, or
  tokenized asset platforms. Also use when the user says "check RWA", "find tokenized",
  "quote tsla", "discover gold", "venue coverage", or "RWA liquidity".
---

# RWA Market Research with the `rwa` CLI

You have access to the `rwa` CLI for tokenized real-world asset research. Use it via Bash.

## Workflow

### 1. Discovery (unknown asset or broad search)

When the user wants to find tokenized assets or explore what's available:

```bash
node src/cli.js discover <query> --json
# Example: node src/cli.js discover gold --json
# Example: node src/cli.js discover tesla --json
```

This searches CMC, CoinGecko, Dinari dShares, and Uniblock categories. Returns wrappers, venues, and market pairs.

Add `--refresh` to bypass the 24-hour cache.

### 2. Resolution (map query to canonical symbol)

When you need to resolve an ambiguous name to exact symbols and venue coverage:

```bash
node src/cli.js resolve <query> --json
# Example: node src/cli.js resolve tsla --json
# Example: node src/cli.js resolve xau --json
```

### 3. Quote (cross-venue price comparison)

When the user wants live prices, deviation from reference, bid/ask, and liquidity:

```bash
node src/cli.js quote <symbol> --json
# Example: node src/cli.js quote tsla --json
# Example: node src/cli.js quote gold --json
# Example: node src/cli.js quote nvda --venue vest --json
```

Key fields in output:
- `price`, `bid`, `ask` - venue-native prices
- `referencePrice` - Yahoo Finance benchmark
- `priceDeviationPct` - deviation from reference
- `liquidity2Pct` - combined notional within +/-2% of mid
- `onchainMarkets` - DEX pools with TVL and volume
- `supportedNetworks` - chains and contract addresses

### 4. Venue & Asset listing

```bash
node src/cli.js venues --json          # all venues with market counts
node src/cli.js assets --json          # all discovered assets
node src/cli.js assets --venue ondo --json  # assets on a specific venue
```

### 5. Normalized snapshot (for downstream ingestion)

```bash
node src/cli.js discover-snapshot <query> --json
node src/cli.js discover-snapshot <query> --out tmp/snapshot.json
```

## Decision Guide

| User intent | Command |
|---|---|
| "What tokenized assets exist for X?" | `discover <X> --json` |
| "Which venues list X?" | `resolve <X> --json` |
| "What's the price of X across venues?" | `quote <X> --json` |
| "Compare liquidity for X" | `quote <X> --json` (check `liquidity2Pct`) |
| "List all assets on venue Y" | `assets --venue <Y> --json` |
| "Show all supported venues" | `venues --json` |

## Important Notes

- Always use `--json` for structured output that you can parse
- Use `--agent` instead of `--json` when you need the full envelope with `ok`, `command`, `generatedAt`, and structured errors
- If `quote` returns `ASSET_AMBIGUOUS`, use `resolve` first to pick the exact symbol, then `quote <symbol> --exact`
- The CLI runs from the project root: `node src/cli.js ...`
- Some venues need API keys. Missing keys are reported as advisories in the output but don't block the command
- Cache is at `.cache/rwa/`, 24h TTL. Use `--refresh` to bypass or `node src/cli.js cache clear` to wipe

## Supported Venues

CEX: binance, bingx, bitget, bitmart, bybit, gate, lbank, lighter, mexc, ourbit, stablestock, trade.xyz, vest, xt
Issuers: backed, dinari, ondo, remora, securitize, stokr, superstate, swarm, wisdomtree, xstocks
Aggregator: coingecko, raydium
