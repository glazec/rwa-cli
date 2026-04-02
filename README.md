# `rwa`

`rwa` is a small CLI for discovering tokenized real-world asset markets and comparing live venue quotes.

Current venue adapters:

- `bitget`
- `binance`
- `coingecko`
- `gate`
- `trade.xyz`
- `lighter`
- `mexc`
- `ondo`
- `stablestock`
- `vest`
- `xstocks`
- issuer summaries from `rwa.xyz`: `dinari`, `securitize`, `superstate`, `wisdomtree`, `stokr`, `backed`, `remora`, `swarm`

Current commands:

- `rwa venues`
- `rwa assets`
- `rwa discover <query>`
- `rwa resolve <asset>`
- `rwa assets --venue lighter`
- `rwa quote tsla`
- `rwa quote gold --json`

## Install

```bash
npm install
npm link
```

Or run without linking:

```bash
node src/cli.js quote tsla
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
- CoinGecko tokenized-gold markets for tokenized commodity discovery

If you have a CoinGecko key, export one of:

```bash
export COINGECKO_API_KEY=...
# or
export COINGECKO_PRO_API_KEY=...
```

When either variable is set, `rwa` uses CoinGecko's Pro host automatically.

## Notes

- `+/-2% liquidity` is normalized as combined notional liquidity resting within 2% of the mid price when the venue exposes an order book.
- `price deviation` is computed as `(venue price - Yahoo reference price) / Yahoo reference price * 100`.
- Some venues do not expose public bid/ask or order-book depth for these assets. Those fields are returned as `null` and shown as `-` in table output.
- Lighter currently uses public REST endpoints for mark/volume/OI/funding. Its order-book websocket is not yet reliably reproducible from this Node CLI, so bid/ask and `+/-2% liquidity` may be `null`.
- Yahoo reference prices come from Yahoo Finance's public `v8/finance/chart` endpoint with symbol mapping for commodities and selected non-US assets.
- `coingecko` currently acts as a bootstrap source for tokenized gold assets such as `XAUT`, `PAXG`, `KAU`, `PGOLD`, `XAUM`, and `GGBR`. Those prices are not venue-native and will be replaced with native connectors over time.
- `discover` currently uses CoinMarketCap internal endpoints. They are effective for RWA discovery but are undocumented and may change.

## Sources

- Source strategy and rollout plan: [docs/data-sources.md](./docs/data-sources.md)

## Agent Mode

- `--agent` returns a stable JSON envelope with `ok`, `command`, `generatedAt`, `query`, and `data`.
- Structured errors are emitted with machine-readable `error.code`, `error.message`, and `error.details`.
- `resolve` gives agents a deterministic first step for canonical symbol lookup before calling `quote`.
- `quote --exact` avoids fuzzy matching when an agent already knows the intended symbol.
