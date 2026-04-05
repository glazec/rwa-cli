# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm install
node src/cli.js <command>    # run directly
npm link && rwa <command>    # or link globally
```

## Test

```bash
npm test                     # runs all tests via node --test
node --test test/market.test.js  # single test file
```

Tests use Node's built-in test runner (`node:test`) with `node:assert/strict`. No test framework dependencies. Some tests call live venue APIs (lbank, xt, bitmart, etc.) so they need network access and may be slow.

## Verify & Publish

```bash
npm run verify:data          # scripts/verify-data.js
npm run pack:check           # npm pack --dry-run
npm publish                  # prepack runs tests automatically
```

## Architecture

Pure ESM (`"type": "module"` in package.json). No build step, no TypeScript. Node 20+.

### Entry Point

`src/cli.js` - Commander-based CLI. Defines all commands (`discover`, `quote`, `resolve`, `assets`, `venues`, `cache`, `config`). Handles three output modes: human-readable tables, `--json`, and `--agent` (structured envelopes with `ok`, `command`, `data`).

### Layer Structure

```
src/cli.js           Command definitions, output rendering, error handling
src/services/        Orchestration layer
  registry.js        Central venue registry (VENUES Map), quote aggregation, reference price enrichment
  discovery.js       Multi-source asset discovery (CMC, CoinGecko, Dinari, Uniblock categories)
  query.js           Asset aggregation, fuzzy/exact matching across venues
  reference.js       Yahoo Finance reference price lookups for deviation calculation
src/venues/          One file per venue adapter, each exports listMarkets() and getQuotes()
  issuers.js         Groups rwa.xyz issuer adapters (dinari, securitize, backed, etc.)
src/lib/             Shared utilities
  assets.js          Symbol canonicalization (TSLA aliases, commodity mappings)
  market.js          Liquidity and price deviation math
  cache.js           Disk-based JSON cache with configurable TTL
  config.js          ~/.config/rwa-cli/config.json management
  format.js          Table rendering, currency/percent formatting
  http.js            Shared fetch wrapper
  route-liquidity.js Multi-provider route-based liquidity estimation (Jupiter, Odos, Li.fi, 1inch)
  onchain-data.js    Onchain metric normalization helpers
  networks.js        Network-to-explorer-URL mapping
src/data/assets.js   Static asset data: symbol aliases, manual overrides, excluded symbols
```

### Adding a New Venue

1. Create `src/venues/<name>.js` exporting `listMarkets()` (returns market array) and `getQuotes(symbols)`.
2. Each market object must include: `symbol`, `name`, `category`, `venue`, `type`, `venueTicker`, `aliases`, `entityKind`, `supportedNetworks`.
3. Use `canonicalSymbol()` from `src/lib/assets.js` to normalize venue-specific tickers to canonical symbols.
4. Register in `src/services/registry.js` VENUES Map.
5. Add ticker resolution tests to `test/market.test.js`.

### Key Patterns

- **Symbol canonicalization**: All venue tickers normalize to canonical symbols (e.g., `TSLAON`, `TSLAx`, `TSLAX` all become `TSLA`). Aliases defined in `src/data/assets.js`.
- **Venue adapter contract**: Every venue file exports `listMarkets()` returning a flat array of market records, and `getQuotes(symbols)` returning enriched quote objects.
- **Cache**: Disk-based under `.cache/rwa/` (configurable via `RWA_CACHE_DIR`). 24h TTL for discovery, 1h for slippage. Bypass with `--refresh` flag.
- **Config cascade**: `process.env` > `.env` > `~/.config/rwa-cli/config.json`.
- **Reference prices**: Yahoo Finance `v8/finance/chart` endpoint. Price deviation = `(venue - reference) / reference * 100`.
- **Route liquidity**: Multi-provider waterfall (Jupiter for Solana, Odos/Li.fi/1inch for EVM). Falls back to next provider on failure.

### Claude Code Plugin

The repo ships as a Claude Code plugin (`.claude-plugin/plugin.json` + `skills/`):

- `skills/rwa-research/SKILL.md` - auto-triggered skill teaching AI how to use the CLI for RWA research
- `skills/rwa/SKILL.md` - user-invoked `/rwa` slash command for quick lookups

When editing skills, keep the decision guide table and command mapping in sync with actual CLI commands in `src/cli.js`.
