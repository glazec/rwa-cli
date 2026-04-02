const EVM_EXPLORERS = {
  ethereum: "https://etherscan.io",
  base: "https://basescan.org",
  arbitrum: "https://arbiscan.io",
  polygon: "https://polygonscan.com",
  avalanche: "https://snowtrace.io",
  avalanchecchain: "https://snowtrace.io",
  bnb: "https://bscscan.com",
  bnbchain: "https://bscscan.com",
  mantle: "https://explorer.mantle.xyz",
  optimism: "https://optimistic.etherscan.io"
};

const NON_EVM_EXPLORERS = {
  solana: "https://solscan.io",
  ton: "https://tonviewer.com",
  ink: "https://explorer.inkonchain.com",
  stellar: "https://stellar.expert/explorer/public",
  xrpl: "https://livenet.xrpl.org",
  sui: "https://suivision.xyz",
  aptos: "https://explorer.aptoslabs.com"
};

const NETWORK_LABELS = {
  ethereum: "Ethereum",
  solana: "Solana",
  polygon: "Polygon",
  avalanche: "Avalanche C-Chain",
  avalanchecchain: "Avalanche C-Chain",
  bnb: "BNB Chain",
  bnbchain: "BNB Chain",
  base: "Base",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  ton: "TON",
  ink: "Ink",
  mantle: "Mantle",
  stellar: "Stellar",
  xrpl: "XRPL",
  sui: "Sui",
  aptos: "Aptos"
};

export function normalizeNetworkKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function networkDisplayName(value) {
  const key = normalizeNetworkKey(value);
  return NETWORK_LABELS[key] ?? String(value || "").trim();
}

export function explorerBaseUrlForNetwork(value) {
  const key = normalizeNetworkKey(value);
  return EVM_EXPLORERS[key] ?? NON_EVM_EXPLORERS[key] ?? null;
}

export function tokenExplorerUrl(network, address = null) {
  const key = normalizeNetworkKey(network);
  const baseUrl = explorerBaseUrlForNetwork(key);

  if (!baseUrl) {
    return null;
  }

  if (!address) {
    return baseUrl;
  }

  if (key === "solana") {
    return `${baseUrl}/token/${address}`;
  }

  if (key === "ton") {
    return `${baseUrl}/address/${address}`;
  }

  if (key === "ink") {
    return `${baseUrl}/token/${address}`;
  }

  if (EVM_EXPLORERS[key]) {
    return `${baseUrl}/token/${address}`;
  }

  return baseUrl;
}
