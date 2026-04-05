# `rwa`

`rwa` is a Node.js CLI for discovering tokenized real-world asset markets, resolving asset wrappers, and comparing live quotes across centralized exchanges, issuers, and onchain venues.

It is designed for research, monitoring, and downstream agent workflows where you need one command-line surface for:

- venue discovery
- symbol and wrapper resolution
- normalized quote comparison
- machine-friendly JSON and agent output

## Requirements

- Node.js `20+`
- npm

Current venue adapters:

- `bitget`
- `binance`
- `bingx`
- `coingecko`
- `gate`
- `bitmart`
- `lbank`
- `trade.xyz`
- `lighter`
- `mexc`
- `ondo`
- `ourbit`
- `raydium`
- `stablestock`
- `vest`
- `xt`
- `xstocks`
- issuer summaries from `rwa.xyz`: `dinari`, `securitize`, `superstate`, `wisdomtree`, `stokr`, `backed`, `remora`, `swarm`

Current commands:

- `rwa venues`
- `rwa assets`
- `rwa discover <query>`
- `rwa discover <query> --refresh`
- `rwa discover-snapshot <query>`
- `rwa cache clear`
- `rwa config list`
- `rwa config set <key> <value>`
- `rwa config unset <key>`
- `rwa resolve <asset>`
- `rwa assets --venue lighter`
- `rwa quote tsla`
- `rwa quote gold --json`

## Install

Clone the repo and install dependencies:

```bash
node --version
npm install
npm link
```

Run the CLI from the shell:

```bash
rwa quote tsla
```

Or run it directly without linking:

```bash
node src/cli.js quote tsla
```

Publish smoke check:

```bash
npm test
npm run pack:check
```

After logging into npm:

```bash
npm publish
```

## Examples

List supported venues:

```bash
rwa venues
```

List all discovered tokenized assets:

```bash
rwa assets
```

List assets on a specific venue:

```bash
rwa assets --venue trade.xyz
```

Query a specific asset across venues:

```bash
rwa quote tesla
rwa quote tsla
rwa quote TSLAONUSDT
rwa quote xau
rwa quote nvda --venue vest
```

JSON output:

```bash
rwa quote tsla --json
rwa discover gold --json
```

Agent-friendly output:

```bash
rwa discover alibaba --agent
rwa resolve tesla --agent
rwa quote TSLA --exact --agent
```

## Discovery

Use `discover` first when you want to map an underlying asset to wrappers and venues:

```bash
rwa discover alibaba
rwa discover gold
```

`discover` uses:

- CoinMarketCap internal RWA endpoints for underlying assets, token wrappers, and venue lists
- Uniblock direct `CoinMarketCap` category endpoints for broader tokenized stock and tokenized commodity asset coverage
- Dinari `dShares` for public stock-list discovery plus `CMC` `*.D` wrappers for Dinari contract-address discovery
- CoinGecko tokenized-gold markets for tokenized commodity discovery

Force a refresh if you want to bypass the 24-hour cache:

```bash
rwa discover gold --refresh
```

Build a normalized discovery snapshot for downstream ingestion:

```bash
rwa discover-snapshot gold --json
rwa discover-snapshot gold --out tmp/discovery-gold.json
```

If you have a CoinGecko key, export one of:

```bash
export COINGECKO_API_KEY=...
# or
export COINGECKO_PRO_API_KEY=...
```

When either variable is set, `rwa` uses CoinGecko's Pro host automatically.

Optional onchain enrichment keys:

```bash
export BIRDEYE_API_KEY=...
export UNIBLOCK_API_KEY=...
export ODOS_API_KEY=...
export LIFI_API_KEY=...
export ONEINCH_API_KEY=...
export OKX_API_KEY=...
export OKX_SECRET_KEY=...
export OKX_API_PASSPHRASE=...
export ZEROX_API_KEY=...
```

Or persist them locally:

```bash
rwa config set birdeye ...
rwa config set uniblock ...
rwa config set odos ...
rwa config set lifi ...
rwa config set 1inch ...
rwa config set okx ...
rwa config set okxsecret ...
rwa config set okxpassphrase ...
rwa config set 0x ...
rwa config list
```

The CLI loads environment variables first and falls back to `~/.config/rwa-cli/config.json`.
For provider-specific coverage, `rwa` prefers sources that can run without API keys when possible, skips key-only providers when credentials are missing, and prints setup hints in terminal output when optional keys would widen coverage.

Discovery cache:

```bash
# optional, defaults to ./.cache/rwa
export RWA_CACHE_DIR=...

# optional, defaults to 24
export RWA_CACHE_TTL_HOURS=24

# optional, defaults to 1
export RWA_SLIPPAGE_CACHE_TTL_HOURS=1
```

## Notes

- `+/-2% liquidity` is normalized as combined notional liquidity resting within 2% of the mid price when the venue exposes an order book.
- `price deviation` is computed as `(venue price - Yahoo reference price) / Yahoo reference price * 100`.
- Some venues do not expose public bid/ask or order-book depth for these assets. Those fields are returned as `null` and shown as `-` in table output.
- Lighter now uses public REST endpoints for mark/volume/OI/funding plus its public order-book websocket, so `bid`, `ask`, and `+/-2% liquidity` are available when the websocket returns a live book snapshot.
- XT's frontend uses the same public `market/public` ticker and depth endpoints as the CLI. Some direct symbols such as `gold_usdt` still publish an empty book there, so `bid`, `ask`, and `+/-2% liquidity` stay `null`.
- Ourbit's frontend uses open `platform/spot/market` endpoints, and the CLI now reads ticker plus live depth directly from those routes.
- BingX spot is now connected through the public `openApi` market endpoints. The browser frontend still uses signed first-party calls internally, but the public spot ticker and depth routes are sufficient for native bid, ask, and `+/-2%` liquidity.
- Yahoo reference prices come from Yahoo Finance's public `v8/finance/chart` endpoint with symbol mapping for commodities and selected non-US assets.
- `coingecko` now acts as a broader bootstrap source across tokenized stocks, commodities, silver, ETFs, real estate, and treasury categories. Those prices are not venue-native and will be replaced with native connectors over time.
- `xstocks` and `ondo` use `Birdeye` to enrich Solana and EVM token market data, holder count, market cap, and onchain market lists. The CLI will use native `BIRDEYE_API_KEY` if present, otherwise it falls back to `Uniblock direct/Birdeye` via `UNIBLOCK_API_KEY`.
- `xstocks` now uses `Jupiter`'s Solana quote API to estimate Solana-side `+/-2% liquidity`, with those slippage estimates cached for 1 hour by default.
- `xstocks` now uses `Odos` for Ethereum-side route-based `+/-2% liquidity` when `ODOS_API_KEY` is set.
- `ondo` now uses `Li.fi` and `1inch` for Ethereum and BNB Chain route-based `+/-2% liquidity` when `LIFI_API_KEY` and `ONEINCH_API_KEY` are set, and keeps `Odos` as an additional EVM routing source where available.
- `OKX` wallet quote support is scaffolded, but it requires the full `OKX_API_PASSPHRASE` in addition to key and secret before the CLI can use it.
- `xstocks` now uses `STON.fi` on TON to enrich TON-side price, pool liquidity, and route-based `+/-2% liquidity` where TON pools exist.
- `raydium` is now a first-class Solana venue in the CLI for xStocks wrappers that are live on Raydium pools.
- `discover` currently uses CoinMarketCap internal endpoints. They are effective for RWA discovery but are undocumented and may change.
- `discover` also uses `Uniblock` direct `CoinMarketCap` category endpoints, when `UNIBLOCK_API_KEY` is set, to widen coverage for tokenized stock, commodities, silver, ETFs, real estate, and treasury categories.
- discovery responses are cached on disk for 24 hours by default under `.cache/rwa` to avoid repeatedly pulling the same category and RWA listing data.

## Sources

- Source strategy and rollout plan: [docs/data-sources.md](./docs/data-sources.md)

## Agent Mode

- `--agent` returns a stable JSON envelope with `ok`, `command`, `generatedAt`, `query`, and `data`.
- Structured errors are emitted with machine-readable `error.code`, `error.message`, and `error.details`.
- `resolve` gives agents a deterministic first step for canonical symbol lookup before calling `quote`.
- `quote --exact` avoids fuzzy matching when an agent already knows the intended symbol.

## License

[MIT](./LICENSE)
