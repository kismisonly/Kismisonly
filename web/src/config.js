// Nilai jaringan dari env Vite. Default = Robinhood Mainnet + kontrak kanonik Doppler.
import { isAddress } from "ethers";
import { ROBINHOOD } from "./doppler.js";

const env = import.meta.env;
const platform = env.VITE_PLATFORM_ADDRESS || "";
const platformBps = Number(env.VITE_PLATFORM_SHARE_BPS ?? 500);

export const config = {
  chainId: Number(env.VITE_CHAIN_ID || ROBINHOOD.chainId),
  chainName: env.VITE_CHAIN_NAME || "Robinhood Chain",
  rpcUrl: env.VITE_RPC_URL || "",
  explorer: (env.VITE_EXPLORER_URL || "https://robinhoodchain.blockscout.com").replace(/\/$/, ""),
  nativeSymbol: env.VITE_NATIVE_SYMBOL || "ETH",
  // Bagian fee untuk pemilik website. Kosong = creator dapat semua kecuali 5% Doppler.
  platform: isAddress(platform) ? platform : "",
  platformBps: isAddress(platform) ? Math.max(0, Math.min(platformBps, 4_500)) : 0,
  vanitySuffix: (env.VITE_VANITY_SUFFIX || "").toLowerCase().replace(/^0x/, ""),
};

export const shares = {
  protocol: 5,
  platform: config.platformBps / 100,
  creator: 95 - config.platformBps / 100,
};
