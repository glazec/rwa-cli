import test from "node:test";
import assert from "node:assert/strict";

import { canonicalSymbol, inferCategory, isTradableRwaSymbol } from "../src/lib/assets.js";
import { findCmcRwaMatches } from "../src/lib/cmc.js";
import { liquidityWithinPct, priceDeviationPct } from "../src/lib/market.js";
import { tokenExplorerUrl } from "../src/lib/networks.js";
import { aggregateAssets } from "../src/services/query.js";

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
