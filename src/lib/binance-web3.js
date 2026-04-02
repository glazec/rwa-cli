import { fetchJson } from "./http.js";

export const BINANCE_WEB3_URL =
  "https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/unified/rank/list";

export async function fetchBinanceWeb3Tokens() {
  const json = await fetchJson(
    BINANCE_WEB3_URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        clienttype: "web"
      },
      body: JSON.stringify({
        rankType: 40,
        period: 50,
        sortBy: 50,
        orderAsc: false
      })
    },
    12000
  );

  return json?.data?.tokens ?? [];
}
