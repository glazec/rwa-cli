# Data Sources

This document tracks the data model and source priority for `rwa`.

## Goals

`rwa` needs two layers:

1. Discovery
   - find tokenized assets
   - find tokenized wrappers and issuer-specific tickers
   - find which exchanges or issuers support each underlying asset
2. Trading data
   - venue price
   - bid / ask
   - `+/-2%` liquidity
   - volume
   - open interest and funding for perps

## Source Priority

### 1. Native venue APIs

Use these whenever a venue exposes public REST or websocket data.

- `bitget`
- `trade.xyz`
- `lighter`
- `vest`
- `ondo`
- `binance`
- `gate`
- `mexc`
- `xstocks`
- `stablestock`

Why:
- best source for venue-specific price
- needed for bid / ask
- needed for book-based `+/-2%` liquidity
- needed for perp OI and funding

### 2. CoinMarketCap internal RWA endpoints

Use these for discovery and temporary venue coverage where native connectors do not exist yet.

Endpoints currently validated:

- `https://s3.coinmarketcap.com/generated/core/rwa/search.json`
- `https://api.coinmarketcap.com/data-api/v3/rwa/asset/list?slug=<slug>`
- `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/market-pairs/latest?rwaSlug=<slug>`
- `https://api.coinmarketcap.com/data-api/v3/rwa/web/exchange-pair-info?slug=<slug>`

What they give us:

- underlying RWA asset discovery
- tokenized wrappers for an underlying asset
- venue list for an asset
- venue price
- venue 24h volume
- `depthUsdNegativeTwo` / `depthUsdPositiveTwo` for many spot venues
- contract addresses and market URLs

Limits:

- internal, undocumented, can change without notice
- not a full replacement for native venue APIs
- no reliable perp OI / funding observed so far

### 3. CoinGecko API

Use this for category-level token discovery and bootstrap price coverage, especially tokenized commodities.

Current usage:

- `tokenized-gold` category
- optional `COINGECKO_API_KEY` or `COINGECKO_PRO_API_KEY`
- switch to `https://pro-api.coingecko.com/api/v3` automatically when a key is present

What it gives us:

- tokenized gold discovery
- market price
- 24h volume
- market cap
- token contract platforms for many assets

Limits:

- not a venue
- no bid / ask
- no book depth
- no OI / funding
- some token units differ from spot gold reference units

### 4. Yahoo Finance

Use this for reference price only.

What it gives us:

- canonical underlying asset reference for deviation calculations

Limits:

- not used for trading venue data
- tokenized commodity wrappers may need per-token unit scaling before deviation is meaningful

## Current Connector Status

### Native connectors already implemented

- `bitget`
- `trade.xyz`
- `lighter`
- `vest`
- `ondo`
- `binance`
- `gate`
- `mexc`
- `xstocks`
- `stablestock`

### Issuer / platform summaries implemented from `rwa.xyz`

- `securitize`
- `dinari`
- `superstate`
- `wisdomtree`
- `stokr`
- `backed`
- `remora`
- `swarm`

These are issuer-level summaries, not exchange venues.

## Discovery-first roadmap

### Phase 1

- `CMC` search index for underlying asset discovery
- `CMC` market-pairs for venue discovery
- `CoinGecko` tokenized-gold category for commodity token discovery

### Phase 2

Replace `CMC` venue rows with native connectors in descending observed volume priority.

Initial target order:

1. `Gate`
2. `MEXC`
3. `LBank`
4. `XT.COM`
5. `BitMart`
6. `BingX`
7. `Ourbit`

Note:
- `Bitget`, `Ondo`, `Binance Alpha` / Binance Web3, and `trade.xyz` are already covered.
- `CMC` is still useful as the discovery layer even after native connectors are added.

## Field ownership

### Discovery layer

- underlying asset name / symbol / slug: `CMC`
- token wrappers and issuer mappings: `CMC`
- tokenized commodity coverage: `CoinGecko`

### Trading layer

- price: native connector first, `CoinGecko` bootstrap fallback for tokenized commodities
- volume: native connector first, `CMC` fallback when no direct connector exists yet
- bid / ask: native connector only
- `+/-2%` liquidity: native connector first, `CMC` fallback if exposed
- OI / funding: native perp connector only
