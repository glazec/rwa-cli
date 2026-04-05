import test from "node:test";
import assert from "node:assert/strict";

import { canonicalSymbol, inferCategory, isTradableRwaSymbol } from "../src/lib/assets.js";
import { dedupeCmcCategoryCoins, findCmcCategoryMatches, findCmcRwaMatches } from "../src/lib/cmc.js";
import { birdeyeChainForNetwork } from "../src/lib/birdeye.js";
import { coinGeckoOnchainNetworkForNetwork } from "../src/lib/coingecko.js";
import { findDinariDsharesMatches, parseDinariDsharesHtml } from "../src/lib/dinari.js";
import { liquidityWithinPct, priceDeviationPct } from "../src/lib/market.js";
import { tokenExplorerUrl } from "../src/lib/networks.js";
import { maxMetric, optionalNumber, sortNetworkRows, sumMetric } from "../src/lib/onchain-data.js";
import { okxChainIndexForNetwork } from "../src/lib/okx.js";
import {
  estimatePreferredRouteLiquidity,
  missingRouteLiquidityProviderSettings,
  routeLiquidityProviderRequirements
} from "../src/lib/route-liquidity.js";
import { aggregateAssets } from "../src/services/query.js";
import { assetSymbolToYahoo } from "../src/services/reference.js";
import { buildDiscoverySnapshot } from "../src/services/discovery.js";
import * as bingx from "../src/venues/bingx.js";
import * as bitmart from "../src/venues/bitmart.js";
import * as bybit from "../src/venues/bybit.js";
import * as lbank from "../src/venues/lbank.js";
import * as ourbit from "../src/venues/ourbit.js";
import * as raydium from "../src/venues/raydium.js";
import * as remora from "../src/venues/remora.js";
import * as xt from "../src/venues/xt.js";

test("canonicalSymbol normalizes commodity aliases", () => {
  assert.equal(canonicalSymbol("gold"), "XAU");
  assert.equal(canonicalSymbol("silver"), "XAG");
  assert.equal(canonicalSymbol("cl"), "WTI");
});

test("inferCategory excludes fx pairs", () => {
  assert.equal(inferCategory("EURUSD", "EUR vs USD"), "fx");
  assert.equal(isTradableRwaSymbol("EURUSD", "EUR vs USD"), false);
  assert.equal(isTradableRwaSymbol("TSLA", "Tesla"), true);
});

test("liquidityWithinPct sums both sides around mid", () => {
  const value = liquidityWithinPct({
    bids: [
      { price: 100, size: 2 },
      { price: 98.5, size: 1 },
      { price: 96, size: 10 }
    ],
    asks: [
      { price: 101, size: 1 },
      { price: 102, size: 3 },
      { price: 105, size: 10 }
    ]
  });

  assert.equal(value, 705.5);
});

test("priceDeviationPct computes delta versus reference price", () => {
  assert.equal(priceDeviationPct(102, 100), 2);
  assert.equal(priceDeviationPct(98, 100), -2);
  assert.equal(priceDeviationPct(null, 100), null);
});

test("tokenExplorerUrl maps common networks", () => {
  assert.equal(
    tokenExplorerUrl("ethereum", "0xabc"),
    "https://etherscan.io/token/0xabc"
  );
  assert.equal(
    tokenExplorerUrl("solana", "TokenAddress"),
    "https://solscan.io/token/TokenAddress"
  );
  assert.equal(tokenExplorerUrl("arbitrum"), "https://arbiscan.io");
});

test("birdeyeChainForNetwork normalizes supported chains", () => {
  assert.equal(birdeyeChainForNetwork("solana"), "solana");
  assert.equal(birdeyeChainForNetwork("ethereum"), "ethereum");
  assert.equal(birdeyeChainForNetwork("bnb chain"), "bsc");
  assert.equal(birdeyeChainForNetwork("ink"), null);
});

test("coinGeckoOnchainNetworkForNetwork normalizes supported chains", () => {
  assert.equal(coinGeckoOnchainNetworkForNetwork("solana"), "solana");
  assert.equal(coinGeckoOnchainNetworkForNetwork("ethereum"), "eth");
  assert.equal(coinGeckoOnchainNetworkForNetwork("bnb chain"), "bsc");
  assert.equal(coinGeckoOnchainNetworkForNetwork("ink"), null);
});

test("okxChainIndexForNetwork maps supported chains", () => {
  assert.equal(okxChainIndexForNetwork("solana"), 501);
  assert.equal(okxChainIndexForNetwork("ethereum"), 1);
  assert.equal(okxChainIndexForNetwork("bnb chain"), 56);
  assert.equal(okxChainIndexForNetwork("ink"), null);
});

test("optionalNumber and metric helpers normalize nullable onchain values", () => {
  assert.equal(optionalNumber("12.5"), 12.5);
  assert.equal(optionalNumber(null), null);
  assert.equal(sumMetric([{ value: 2 }, { value: 3 }, { value: null }], "value"), 5);
  assert.equal(maxMetric([{ value: 2 }, { value: 7 }, { value: null }], "value"), 7);
});

test("sortNetworkRows prefers higher liquidity before volume", () => {
  const rows = sortNetworkRows([
    { network: "A", liquidityUsd: 10, volume24h: 100 },
    { network: "B", liquidityUsd: 20, volume24h: 50 },
    { network: "C", liquidityUsd: 20, liquidity2Pct: 30, volume24h: 10 }
  ]);

  assert.deepEqual(rows.map((row) => row.network), ["C", "B", "A"]);
});

test("estimatePreferredRouteLiquidity falls back to the first successful provider", async () => {
  const result = await estimatePreferredRouteLiquidity("0xabc", {
    network: "ethereum",
    decimals: 18,
    providers: [
      {
        source: "first",
        estimate: async () => null
      },
      {
        source: "second",
        estimate: async () => ({ liquidityUsd: 123 })
      },
      {
        source: "third",
        estimate: async () => ({ liquidityUsd: 456 })
      }
    ]
  });

  assert.equal(result.provider, "second");
  assert.equal(result.liquidityUsd, 123);
});

test("route liquidity provider requirements expose key-only providers", () => {
  assert.deepEqual(routeLiquidityProviderRequirements("odos_quote"), []);
  assert.deepEqual(routeLiquidityProviderRequirements("oneinch_quote"), ["ONEINCH_API_KEY"]);
  assert.ok(Array.isArray(missingRouteLiquidityProviderSettings("oneinch_quote")));
});

test("assetSymbolToYahoo maps tokenized gold wrappers to the gold benchmark", () => {
  assert.equal(assetSymbolToYahoo("XAUT"), "GC=F");
  assert.equal(assetSymbolToYahoo("PAXG"), "GC=F");
  assert.equal(assetSymbolToYahoo("XAUM"), "GC=F");
  assert.equal(assetSymbolToYahoo("XAU"), "GC=F");
});

test("aggregateAssets carries entity kinds and network coverage", () => {
  const assets = aggregateAssets([
    {
      symbol: "TSLA",
      name: "Tesla",
      category: "equity",
      entityKind: "asset",
      venue: "xstocks",
      type: "spot",
      venueTicker: "TSLAx",
      aliases: ["Tesla xStock"],
      supportedNetworks: [
        { network: "Ethereum" },
        { network: "Solana" }
      ]
    },
    {
      symbol: "DINARI",
      name: "Dinari",
      category: "issuer",
      entityKind: "issuer",
      venue: "dinari",
      type: "issuer",
      venueTicker: "dinari",
      aliases: ["dinari"],
      supportedNetworks: [{ network: "Arbitrum" }]
    }
  ]);

  assert.deepEqual(
    assets.find((asset) => asset.symbol === "TSLA")?.entityKinds,
    ["asset"]
  );
  assert.deepEqual(
    assets.find((asset) => asset.symbol === "TSLA")?.networks,
    ["Ethereum", "Solana"]
  );
  assert.deepEqual(
    assets.find((asset) => asset.symbol === "DINARI")?.entityKinds,
    ["issuer"]
  );
});

test("findCmcRwaMatches prefers exact symbol matches", () => {
  const matches = findCmcRwaMatches(
    [
      { symbol: "TSLA", slug: "tesla", name: "Tesla, Inc.", rank: 11 },
      { symbol: "TSLQ", slug: "inverse-tesla", name: "Inverse Tesla", rank: 200 }
    ],
    "tsla",
    10
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].symbol, "TSLA");
});

test("dedupeCmcCategoryCoins keeps the higher market-cap duplicate", () => {
  const coins = dedupeCmcCategoryCoins([
    { symbol: "PAXG", slug: "pax-gold", marketCap: 10, categoryName: "Tokenized Gold" },
    { symbol: "PAXG", slug: "pax-gold", marketCap: 20, categoryName: "Tokenized commodities" }
  ]);

  assert.equal(coins.length, 1);
  assert.equal(coins[0].marketCap, 20);
  assert.equal(coins[0].categoryName, "Tokenized commodities");
});

test("findCmcCategoryMatches prefers exact symbol matches and sorts by market cap", () => {
  const matches = findCmcCategoryMatches(
    [
      { symbol: "PAXG", slug: "pax-gold", name: "PAX Gold", marketCap: 100 },
      { symbol: "PAX", slug: "pax-dollar", name: "Pax Dollar", marketCap: 1000 },
      { symbol: "XAUt", slug: "tether-gold", name: "Tether Gold", marketCap: 200 }
    ],
    "paxg",
    10
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].symbol, "PAXG");
});

test("parseDinariDsharesHtml extracts public dShares list rows", () => {
  const rows = parseDinariDsharesHtml(`
    <div class="asset-explore-row">
      <img src="https://cdn.example.com/AAPL.d.png" />
      <div class="asset-text">AAPL</div><div class="asset-text ml-16">Apple Inc.</div>
    </div></div>
    <div class="asset-explore-row">
      <img src="https://cdn.example.com/GOOGL.d.png" />
      <div class="asset-text">GOOGL</div><div class="asset-text ml-16">Alphabet Inc. Class A</div>
    </div></div>
  `);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].symbol, "AAPL");
  assert.equal(rows[0].venueTicker, "AAPL.D");
  assert.equal(rows[1].name, "Alphabet Inc. Class A");
});

test("findDinariDsharesMatches matches by ticker and dShare symbol", () => {
  const matches = findDinariDsharesMatches(
    [
      { symbol: "AAPL", venueTicker: "AAPL.D", name: "Apple Inc." },
      { symbol: "GOOGL", venueTicker: "GOOGL.D", name: "Alphabet Inc. Class A" }
    ],
    "googl.d",
    10
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].symbol, "GOOGL");
});

test("buildDiscoverySnapshot merges overlapping token discovery sources", () => {
  const snapshot = buildDiscoverySnapshot({
    query: "gold",
    cmc: {
      selected: { slug: "gold", symbol: "GOLD" },
      matches: [{ slug: "gold", symbol: "GOLD" }],
      tokens: [
        {
          id: 4705,
          symbol: "PAXG",
          name: "PAX Gold",
          slug: "pax-gold",
          issuer: "Paxos",
          price: 4660,
          volume24h: 100,
          marketCap: 200,
          contractAddresses: ["0xabc"]
        }
      ],
      marketPairs: [{ exchange: "Binance" }],
      exchanges: [{ exchange: "Binance" }]
    },
    cmcCategories: {
      categoryCount: 1,
      categories: [{ id: "cat", name: "Tokenized commodities", slug: "tokenized-commodities" }],
      matches: [
        {
          id: 4705,
          symbol: "PAXG",
          name: "PAX Gold",
          slug: "pax-gold",
          category: "Tokenized commodities",
          price: 4661,
          volume24h: 101,
          marketCap: 250,
          numMarketPairs: 390,
          platform: { slug: "ethereum", tokenAddress: "0xabc" }
        }
      ]
    },
    coingecko: {
      matchCount: 1,
      matches: [
        {
          id: "pax-gold",
          symbol: "PAXG",
          name: "PAX Gold",
          price: 4662,
          volume24h: 102,
          marketCap: 240,
          categories: ["Tokenized Gold"],
          supportedNetworks: [{ network: "ethereum", address: "0xabc" }]
        }
      ]
    },
    dinari: {
      matchCount: 1,
      matches: [{ symbol: "PAXG", venueTicker: "PAXG.D", name: "PAX Gold" }],
      tokenMatchCount: 0,
      tokens: []
    }
  });

  assert.equal(snapshot.tokens.length, 1);
  assert.equal(snapshot.tokens[0].symbol, "PAXG");
  assert.equal(snapshot.tokens[0].issuer, "Paxos");
  assert.equal(snapshot.tokens[0].numMarketPairs, 390);
  assert.deepEqual(snapshot.tokens[0].sourceTags.sort(), ["cmc-category", "cmc-rwa-token", "coingecko"]);
  assert.equal(snapshot.sources.dinari, true);
  assert.equal(snapshot.summary.dinariMatchCount, 1);
});

test("lbank resolves wrapped venue tickers to canonical symbols", async () => {
  const markets = await lbank.listMarkets();
  const tickers = new Map(markets.map((market) => [market.venueTicker, market.symbol]));

  assert.equal(tickers.get("tslaon_usdt"), "TSLA");
  assert.equal(tickers.get("tslax_usdt"), "TSLA");
  assert.equal(tickers.get("paxg_usdt"), "PAXG");
});

test("xt resolves direct and wrapped venue tickers to canonical symbols", async () => {
  const markets = await xt.listMarkets();
  const tickers = new Map(markets.map((market) => [market.venueTicker, market.symbol]));

  assert.equal(tickers.get("tslaon_usdt"), "TSLA");
  assert.equal(tickers.get("tslax_usdt"), "TSLA");
  assert.equal(tickers.get("gold_usdt"), "XAU");
});

test("bitmart resolves direct and wrapped venue tickers to canonical symbols", async () => {
  const markets = await bitmart.listMarkets();
  const tickers = new Map(markets.map((market) => [market.venueTicker, market.symbol]));

  assert.equal(tickers.get("TSLAX_USDT"), "TSLA");
  assert.equal(tickers.get("BABAON_USDT"), "BABA");
  assert.equal(tickers.get("PAXG_USDT"), "PAXG");
});

test("ourbit resolves direct and wrapped venue tickers to canonical symbols", async () => {
  const markets = await ourbit.listMarkets();
  const tickers = new Map(markets.map((market) => [market.venueTicker, market.symbol]));

  assert.equal(tickers.get("TSLAX_USDT"), "TSLA");
  assert.equal(tickers.get("TSLAON_USDT"), "TSLA");
  assert.equal(tickers.get("PAXG_USDT"), "PAXG");
});

test("raydium resolves solana xstock tickers to canonical symbols", async () => {
  const markets = await raydium.listMarkets();
  const tickers = new Map(markets.map((market) => [market.venueTicker, market.symbol]));

  assert.equal(tickers.get("TSLAx"), "TSLA");
  assert.equal(tickers.get("GOOGLx"), "GOOGL");
  assert.equal(tickers.get("GLDx"), "GLD");
});

test("remora resolves rstock tickers to canonical symbols", async () => {
  const markets = await remora.listMarkets();
  const tickers = new Map(markets.map((market) => [market.venueTicker, market.symbol]));

  assert.equal(tickers.get("TSLAR"), "TSLA");
  assert.equal(tickers.get("MSTRR"), "MSTR");
  assert.equal(tickers.get("GLDR"), "XAU");
  assert.equal(tickers.get("SLVR"), "XAG");
});

test("bingx resolves direct and wrapped venue tickers to canonical symbols", async () => {
  const markets = await bingx.listMarkets();
  const tickers = new Map(markets.map((market) => [market.venueTicker, market.symbol]));

  assert.equal(tickers.get("TSLAX-USDT"), "TSLA");
  assert.equal(tickers.get("TSLAON-USDT"), "TSLA");
  assert.equal(tickers.get("PAXG-USDT"), "PAXG");
});

test("bybit resolves direct and wrapped venue tickers to canonical symbols", async (t) => {
  let markets;

  try {
    markets = await bybit.listMarkets();
  } catch (error) {
    if (/HTTP 403/i.test(String(error?.message || ""))) {
      t.skip("Bybit blocked from current runtime");
      return;
    }
    throw error;
  }

  const tickers = new Map(markets.map((market) => [market.venueTicker, market.symbol]));

  assert.equal(tickers.get("TSLAXUSDT"), "TSLA");
  assert.equal(tickers.get("AAPLXUSDT"), "AAPL");
  assert.equal(tickers.get("XAUTUSDT"), "XAUT");
});
