// Semua nilai jaringan berasal dari env Vite, tidak ada alamat yang di-hardcode.
const env = import.meta.env;

export const config = {
  launchpad: env.VITE_LAUNCHPAD_ADDRESS || "",
  chainId: env.VITE_CHAIN_ID ? Number(env.VITE_CHAIN_ID) : null,
  chainName: env.VITE_CHAIN_NAME || "Robinhood Chain",
  rpcUrl: env.VITE_RPC_URL || "",
  explorer: (env.VITE_EXPLORER_URL || "").replace(/\/$/, ""),
  nativeSymbol: env.VITE_NATIVE_SYMBOL || "ETH",
};

export const isConfigured = Boolean(config.launchpad && config.chainId);

// Harus sama dengan default Launchpad.Config di contracts/Launchpad.sol.
export const scheme = {
  supply: 100_000_000_000,
  poolPct: 85,
  vestPct: 15,
  cliffDays: 30,
  vestDays: 365,
  creatorFeePct: 95,
  platformFeePct: 5,
};
