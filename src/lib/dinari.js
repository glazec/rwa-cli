import { fetchText } from "./http.js";
import { getOrSetCachedJson } from "./cache.js";

const DINARI_DSHARES_URL = "https://dinari.com/dshares";

export function parseDinariDsharesHtml(html) {
  const source = String(html || "");
  const matches = [...source.matchAll(
    /<div class="asset-explore-row">[\s\S]*?<img[^>]+src="([^"]+)"[\s\S]*?<div class="asset-text">([^<]+)<\/div><div class="asset-text ml-16">([^<]+)<\/div>[\s\S]*?<\/div><\/div>/g
  )];

  return matches.map((match) => {
    const imageUrl = match[1] || null;
    const symbol = String(match[2] || "").trim().toUpperCase();
    const name = String(match[3] || "").trim();

    return {
      symbol,
      name,
      venueTicker: `${symbol}.D`,
      issuer: "Dinari Assets",
      imageUrl
    };
  });
}

export async function fetchDinariDsharesList() {
  return getOrSetCachedJson("dinari-dshares-list-v1", async () => {
    const html = await fetchText(
      DINARI_DSHARES_URL,
      {
        headers: {
          "user-agent": "Mozilla/5.0",
          accept: "text/html"
        }
      },
      15000
    );

    return parseDinariDsharesHtml(html);
  });
}

export function findDinariDsharesMatches(items, query, limit = 10) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const exact = items.filter((item) => {
    return (
      String(item.symbol || "").toLowerCase() === normalized ||
      String(item.venueTicker || "").toLowerCase() === normalized ||
      String(item.name || "").toLowerCase() === normalized
    );
  });

  const matches = exact.length
    ? exact
    : items.filter((item) => {
        return (
          String(item.symbol || "").toLowerCase().includes(normalized) ||
          String(item.venueTicker || "").toLowerCase().includes(normalized) ||
          String(item.name || "").toLowerCase().includes(normalized)
        );
      });

  return matches.slice(0, limit);
}
