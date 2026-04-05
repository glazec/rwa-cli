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

## Discovery Cache

Discovery-source payloads are cached on disk for 24 hours by default.

- default cache dir: `.cache/rwa`
- default TTL: `24` hours
- optional overrides:
  - `RWA_CACHE_DIR`
  - `RWA_CACHE_TTL_HOURS`

Slippage-estimate payloads are cached separately for 1 hour by default.

- optional override:
  - `RWA_SLIPPAGE_CACHE_TTL_HOURS`

Current cached discovery sources:

- `CMC` RWA search index
- `CMC` RWA asset lists by slug
- `CMC` RWA market pairs by slug
- `CMC` RWA exchange summaries by slug
- `Uniblock direct/CoinMarketCap` category payloads
- `CoinGecko` tokenized category market lists
- `CoinGecko` coin detail lookups used for network enrichment

## Runtime Behavior

When a provider has a public mode and a keyed mode, the CLI will use the public path when credentials are absent.

- public-first examples:
  - `Odos`
  - `Li.fi`
  - `Jupiter`
- key-only examples:
  - `1inch`
  - `OKX Wallet`

For key-only providers, the CLI skips the provider when credentials are missing and prints setup hints in non-JSON output so users know which keys would improve coverage.

## Source Priority

### 1. Native venue APIs

Use these whenever a venue exposes public REST or websocket data.

- `bitget`
- `trade.xyz`
- `lighter`
- `vest`
- `ondo`
- `binance`
- `bingx`
- `gate`
- `lbank`
- `mexc`
- `xstocks`
- `stablestock`
- `xt`
- `bingx`
- `bitmart`
- `ourbit`
- `raydium`

Why:
- best source for venue-specific price
- needed for bid / ask
- needed for book-based `+/-2%` liquidity
- needed for perp OI and funding
- for `xstocks`, supplement the issuer quote API with chain/address discovery from `https://xstocks.fi/us/products`, Ethereum token-page summaries from Etherscan, and onchain DEX venue discovery from DexScreener

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

### 2.5. Uniblock direct provider gateway

Use `Uniblock` only as a direct-provider proxy layer.

Current rule:

- do not use `Uniblock` unified endpoints for `rwa`
- only use `Uniblock` direct provider routes such as:
  - `direct/v1/Birdeye/...`
  - `direct/v1/CoinMarketCap/...`
  - `direct/v1/Moralis/...`
  - `direct/v1/SolScan/...`

Why:

- unified endpoints depend on Uniblock's own token mapping and provider routing
- wrapper tokens such as `TSLAx` are not consistently mapped there yet
- direct routes preserve provider-native request shape and provider-native response behavior

Confirmed behavior:

- `Uniblock` direct `Birdeye` is well suited for Solana token market data and holder enrichment
- `Uniblock` direct `CoinMarketCap` exposes standard official CMC endpoints such as:
  - `v1/cryptocurrency/listings/latest`
  - `v1/cryptocurrency/market-pairs/latest`
  - `v1/exchange/market-pairs/latest`
- `Uniblock` direct `CoinMarketCap` category endpoints are useful for broader discovery coverage:
  - `v1/cryptocurrency/categories`
  - `v1/cryptocurrency/category?id=<categoryId>`
  - currently used categories:
    - `Tokenized Stock` (`604f2767ebccdd50cd175fd0`)
    - `Tokenized commodities` (`68639a4f358e0763b448bf0c`)
    - `Tokenized Silver` (`68639ad6358e0763b448bf96`)
    - `Tokenized ETFs` (`68639a79358e0763b448bf51`)
    - `Tokenized Assets` (`68638d58358e0763b448b3ca`)
    - `Tokenized Real Estate` (`68639ac1358e0763b448bf90`)
    - `Tokenized Treasury Bills (T-Bills)` (`68639aa7358e0763b448bf8a`)
    - `Tokenized Treasury Bonds (T-Bonds)` (`68639b08358e0763b448c036`)
- `Uniblock` direct `CoinMarketCap` does not expose the `CMC` internal RWA web endpoints we currently rely on:
  - `https://s3.coinmarketcap.com/generated/core/rwa/search.json`
  - `https://api.coinmarketcap.com/data-api/v3/rwa/asset/list`
  - `https://api.coinmarketcap.com/data-api/v3/rwa/web/exchange-pair-info`
- `Uniblock` unified market-data and token endpoints returned mapping/provider failures for `xStocks` Ethereum wrappers in this environment, so they are excluded from the primary path

Implication:

- keep calling `CMC` internal RWA endpoints directly for tokenized-stock discovery
- use `Uniblock` direct providers only for provider-native supplemental data, not for RWA discovery itself

### 3. CoinGecko API

Use this for category-level token discovery and bootstrap price coverage, especially tokenized commodities.

Current usage:

- `tokenized-gold`
- `tokenized-silver`
- `tokenized-commodities`
- `tokenized-stock`
- `tokenized-exchange-traded-funds-etfs`
- `tokenized-products`
- `real-estate`
- `tokenized-t-bills`
- `tokenized-treasury-bonds-t-bonds`
- `xstocks-ecosystem`
- `remora-markets-tokenized-rstocks`
- `ondo-tokenized-assets`
- optional `COINGECKO_API_KEY` or `COINGECKO_PRO_API_KEY`
- switch to `https://pro-api.coingecko.com/api/v3` automatically when a key is present

What it gives us:

- tokenized stock and commodity discovery
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

### 5. Explorer / onchain market supplements

Use these only where the venue or issuer page exposes addresses but not the downstream market details directly.

- `xstocks.fi/us/products`: canonical per-asset chain support and explorer addresses
- `Birdeye`: primary Solana and supported-EVM enrichment for xStocks token market data, liquidity, holder count, and DEX market list
- `Jupiter Swap Quote API`: Solana quote path for estimating xStocks `+/-2%` exit liquidity with hourly caching
- `Odos SOR Quote API`: Ethereum-side route-based quote path for xStocks `+/-2%` exit liquidity when `ODOS_API_KEY` is configured
- `1inch Classic Swap Quote API`: additional EVM quote path for route-based `+/-2%` exit liquidity when `ONEINCH_API_KEY` is configured
- `OKX Wallet DEX Quote API`: optional EVM quote path for route-based `+/-2%` exit liquidity when `OKX_API_KEY`, `OKX_SECRET_KEY`, and `OKX_API_PASSPHRASE` are configured
- `STON.fi REST API`: TON-side asset metadata, pool liquidity, and route-based quote path for xStocks `+/-2%` exit liquidity
- `raydium` venue adapter: first-class Solana venue coverage for xStocks wrappers that have live Raydium pools
- `Uniblock direct/Birdeye`: optional gateway alternative to native Birdeye calls when we want one managed key path
- `Uniblock direct/CoinMarketCap`: standard CMC spot market endpoints only, not the internal RWA web API
- `etherscan.io/token/<address>`: static token summary fields such as holders and onchain market cap for Ethereum-issued xStocks
- `api.dexscreener.com/token-pairs/v1/<chain>/<tokenAddress>`: onchain DEX venue list, 24h volume, liquidity, and market-cap estimates by pair

Limits:

- explorer summaries are chain-specific and currently strongest on Ethereum
- DexScreener does not cover every supported chain equally, so `ton` and `ink` may have no market rows even when the token contract exists
- Jupiter covers Solana only; it is useful for route-based slippage on Solana wrappers but not for Ethereum / Ink / TON
- Odos is EVM-only; in the current xStocks integration it is only used for Ethereum wrappers
- STON.fi covers TON, but current xStocks TON pools are extremely thin, so its `+/-2%` liquidity often comes back near zero
- `sugar-sdk` is not a usable `Ink` quote path as-is; its documented chain support is Base / OP / Uni / Lisk rather than Ink
- Solscan Pro works on `pro-api.solscan.io`, but the current key level tested here is not authorized for the token endpoints we need, so it is not part of the primary path

## Current Connector Status

### Native connectors already implemented

- `bitget`
- `trade.xyz`
- `lighter`
- `vest`
- `ondo`
- `binance`
- `gate`
- `lbank`
- `mexc`
- `xstocks`
- `stablestock`
- `xt`
- `bingx`
- `bitmart`
- `ourbit`
- `raydium`

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

## Confirmed Missing Data

- `xt`: the browser trade page for `paxg_usdt` uses the same public endpoints as the CLI, `https://www.xt.com/sapi/v4/market/public/ticker/24h` and `https://www.xt.com/sapi/v4/market/public/depth`
- `xt`: wrapped markets such as `paxg_usdt`, `xaut_usdt`, and `tslaon_usdt` expose live bids, asks, and usable order books through those endpoints
- `xt`: direct `gold_usdt` currently publishes price and volume but an empty order book, so `bid`, `ask`, and `+/-2%` liquidity remain unavailable
- `xt`: `https://www.xt.com/en/trade/gold_usdt` falls back to `btc_usdt` in the browser, so the page itself is not a reliable source of gold-specific market data
- `bingx`: the browser frontend still uses signed first-party headers on `api-app.qq-os.com`, but the public `open-api.bingx.com/openApi/spot` ticker and depth endpoints are sufficient for native spot bid, ask, and `+/-2%` liquidity, so `bingx` is now connected through those public routes
- `bybit`: browser inspection on April 3, 2026 showed first-party frontend metadata routes on `https://www.bybit.com/x-api/spot/api/basic/*`, including in-session visibility for `XAUTUSDT`, but every tested server-side host (`www.bybit.com/x-api`, `api.bybit.com`, `api.bytick.com`, `api.bybitglobal.com`) returned `403` or country-block errors from this U.S. runtime, so no native adapter is enabled yet
- `lighter`: public `orderBookDetails`, `funding-rates`, and `tokenlist` REST endpoints plus the public `wss://mainnet.zklighter.elliot.ai/stream` order-book websocket are now sufficient for native `bid`, `ask`, and `+/-2%` liquidity from live book snapshots
- `Uniblock direct/CoinMarketCap`: useful for standard CMC crypto market endpoints, but not a replacement for the `CMC` internal RWA endpoints because those are not listed in Uniblock's supported direct CMC routes
- `0x`: free tier is approximately 5 RPS, but tested xStocks Ethereum wrappers returned no usable liquidity in this environment
- `Odos`: enterprise quote API works for xStocks Ethereum wrappers with an API key and is now the primary Ethereum slippage source for xStocks
- `Jupiter`: Metis `/swap/v1/quote` works for xStocks Solana wrappers with an API key and is now the primary Solana slippage source for xStocks
- `STON.fi`: `/v1/assets`, `/v1/pools/by_market`, and `/v1/swap/simulate` work for xStocks TON wrappers, but the tested pools are extremely illiquid
- `1inch`: supports 11 EVM chains through the Developer Portal, but requires an API key and was not the best fit for high-frequency xStocks slippage in this environment
- `OKX`: quote API is available, but requires a full signed credential set including passphrase; without that it cannot be used from the CLI

## Discovery-first roadmap

### Phase 1

- `CMC` search index for underlying asset discovery
- `CMC` market-pairs for venue discovery
- `CoinGecko` tokenized categories for stock and commodity token discovery
- `Dinari` `dShares` page for public stock-list discovery, with `CMC` `*.D` wrappers used to recover Dinari contract addresses when available

### Phase 2

Replace `CMC` venue rows with native connectors in descending observed volume priority.

Initial target order:

1. `Gate`
2. `MEXC`
3. `BingX`
4. `Bybit`

Note:
- `Bitget`, `Ondo`, `Binance Alpha` / Binance Web3, and `trade.xyz` are already covered.
- `Ourbit`, `XT`, `LBank`, and `BitMart` are now covered natively.
- `CMC` is still useful as the discovery layer even after native connectors are added.

## Field ownership

### Discovery layer

- underlying asset name / symbol / slug: `CMC`
- token wrappers and issuer mappings: `CMC`
- Dinari public stock-list discovery: `dinari.com/dshares`
- tokenized commodity coverage: `CoinGecko`
- provider-gateway fallback for supported standard endpoints: `Uniblock direct`

### Trading layer

- price: native connector first, `CoinGecko` bootstrap fallback for tokenized commodities
- volume: native connector first, `CMC` fallback when no direct connector exists yet
- bid / ask: native connector only
- `+/-2%` liquidity: native connector first, `CMC` fallback if exposed
- OI / funding: native perp connector only
