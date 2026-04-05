# Agent Notes

`rwa` is a CLI for tokenized real-world asset discovery and quote inspection across centralized venues, issuer platforms, and onchain markets.

## Preferred Commands

- `rwa discover <query> --json`
  - Use first when the underlying asset is ambiguous and you need wrappers, venues, or related tokenized assets.
- `rwa resolve <query> --json`
  - Use when you want canonical symbols and venue coverage for a user query.
- `rwa quote <symbol> --json`
  - Use for normalized quote inspection across venues.
- `rwa assets --venue <venue> --json`
  - Use to enumerate available assets on a specific venue or issuer.
- `rwa discover-snapshot <query> --json`
  - Use when downstream tooling needs a normalized discovery payload for ingestion.

## Output Shapes

- `discover`
  - discovery-oriented source buckets: `cmc`, `cmcCategories`, `dinari`, `coingecko`
- `resolve`
  - canonical asset matches and venue coverage
- `quote`
  - top-level `asset`
  - `quotes[]` with normalized venue rows
  - `referencePrice` and `priceDeviationPct` when available
  - issuer/onchain rows may include:
    - `supportedNetworks`
    - `onchainNetworkBreakdown`
    - `onchainMarkets`
    - `holders`
    - `totalValue`
    - `onchainMarketCap`
    - `liquidity2Pct`

## Configuration

The CLI loads settings in this order:

1. process environment
2. local `.env`
3. `~/.config/rwa-cli/config.json`

Persist config with:

- `rwa config set <key> <value>`
- `rwa config list`
- `rwa config unset <key>`

Common keys:

- `UNIBLOCK_API_KEY`
- `BIRDEYE_API_KEY`
- `COINGECKO_API_KEY`
- `ODOS_API_KEY`
- `LIFI_API_KEY`
- `ONEINCH_API_KEY`
- `OKX_API_KEY`
- `OKX_SECRET_KEY`
- `OKX_API_PASSPHRASE`
- `JUPITER_API_KEY`

## Provider Behavior

- Prefer providers that do not require API keys when possible.
- Skip key-only providers automatically when credentials are missing.
- Non-JSON terminal output includes setup hints when optional credentials would improve coverage.
- Route-based `liquidity2Pct` is normalized through shared helpers in:
  - `src/lib/route-liquidity.js`
  - `src/lib/onchain-data.js`

## Caching

- discovery cache defaults to 24 hours
- slippage/liquidity cache defaults to 1 hour
- clear cache with `rwa cache clear`
- warm Ondo asset cache with `rwa cache warm ondo`

## Claude Code Plugin

This repo is also a Claude Code plugin. When installed, it provides:

- **`rwa-research` skill**: auto-triggered when the conversation involves tokenized assets, RWA tokens, venue coverage, or onchain liquidity. Guides the agent through the discover/resolve/quote workflow.
- **`/rwa` command**: user-invoked slash command for quick lookups (`/rwa quote tsla`, `/rwa discover gold`, `/rwa tsla`).

Plugin files live in `.claude-plugin/` and `skills/`.

## Publishing

Before publishing:

- `npm test`
- `npm run pack:check`

The package requires Node `20+`.
