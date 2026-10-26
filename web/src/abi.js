export const launchpadAbi = [
  "function config() view returns (uint256 totalSupply, uint16 vestBps, uint64 vestCliff, uint64 vestDuration, uint16 platformFeeBps, address platformTreasury)",
  "function launches(address) view returns (address token, address pool, address vesting, address feeSplitter, address creator, uint64 launchedAt)",
  "function launchCount() view returns (uint256)",
  "function allTokens(uint256) view returns (address)",
  "function launch((string name, string symbol, string uri, address creator, bytes32 salt, bytes poolData, uint256 devBuyMinOut, uint256 seedValue) p) payable returns ((address token, address pool, address vesting, address feeSplitter, address creator, uint64 launchedAt))",
  "event Launched(address indexed token, address indexed creator, address pool, address vesting, address feeSplitter, uint256 poolAmount, uint256 vestAmount, uint256 devBuyOut)",
];

export const splitterAbi = [
  "function pending(address asset, address recipient) view returns (uint256)",
  "function claim(address asset, address recipient)",
];

export const vestingAbi = [
  "function beneficiary() view returns (address)",
  "function totalAllocation() view returns (uint256)",
  "function released() view returns (uint256)",
  "function releasable() view returns (uint256)",
  "function start() view returns (uint64)",
  "function cliff() view returns (uint64)",
  "function duration() view returns (uint64)",
  "function release()",
];

export const erc20Abi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];
