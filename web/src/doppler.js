// Encoder Airlock.create untuk Doppler (DopplerERC20V1 + DopplerHookInitializer).
// Struktur data mengikuti source resmi github.com/whetstoneresearch/doppler (branch main):
//   Airlock.CreateParams, DopplerERC20V1Factory.create, DopplerHookInitializer.InitData,
//   BeneficiaryData (urut naik, total = WAD, protocol owner >= 5%).
import { AbiCoder, concat, getAddress, getCreate2Address, keccak256, toBeHex, zeroPadValue } from "ethers";

export const WAD = 10n ** 18n;
export const MIN_PROTOCOL_OWNER_SHARES = WAD / 20n; // 5%, dipaksa oleh kontrak
export const ETH = "0x0000000000000000000000000000000000000000";

// Kontrak kanonik Doppler di Robinhood Mainnet (chain 4663), dari Deployments.md resmi.
export const ROBINHOOD = {
  chainId: 4663,
  airlock: "0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862",
  tokenFactory: "0x1b37d3a72082029c44b35b604ea473617580b69a",
  poolInitializer: "0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544",
  governanceFactory: "0x85f37f74ef2478a770318bc810177a9835911ad7",
  liquidityMigrator: "0xba2f330edb16cd8056f5988d8ce19bbc63475a0e",
};

// Skema token: sama dengan skema launchpad sebelumnya (100B, 15% vest, 85% pool).
export const SCHEME = {
  supply: 100_000_000_000n * WAD,
  vestBps: 1_500n,
  cliff: 30n * 86_400n,
  duration: 365n * 86_400n,
  lpFee: 10_000, // 1% (satuan pip Uniswap, maks 100_000)
  tickSpacing: 200,
  // Orientasi "asset = token0" (harga = numeraire per token). Kontrak membalik otomatis.
  // 100B supply: FDV awal ~4 ETH di tickLower, sama dengan 1B supply di -193400.
  tickLower: -239_400,
  tickUpper: -129_400,
  farTick: -129_600,
  numPositions: 10,
  protocolShare: MIN_PROTOCOL_OWNER_SHARES,
};

const coder = AbiCoder.defaultAbiCoder();

export const airlockAbi = [
  "function owner() view returns (address)",
  "function create((uint256 initialSupply, uint256 numTokensToSell, address numeraire, address tokenFactory, bytes tokenFactoryData, address governanceFactory, bytes governanceFactoryData, address poolInitializer, bytes poolInitializerData, address liquidityMigrator, bytes liquidityMigratorData, address integrator, bytes32 salt) createData) returns (address asset, address pool, address governance, address timelock, address migrationPool)",
  "event Create(address asset, address indexed numeraire, address initializer, address poolOrHook)",
];

export const tokenFactoryAbi = ["function IMPLEMENTATION() view returns (address)"];

export const initializerAbi = [
  "function collectFees(bytes32 poolId) returns (uint128 fees0, uint128 fees1)",
  "function getShares(bytes32 poolId, address beneficiary) view returns (uint256)",
];

export const dopplerTokenAbi = [
  "function symbol() view returns (string)",
  "function computeAvailableVestedAmount(address beneficiary) view returns (uint256)",
  "function release(uint256 amount)",
];

export function vestAmount(scheme = SCHEME) {
  return (scheme.supply * scheme.vestBps) / 10_000n;
}

/// Susun beneficiaries fee: protocol owner (wajib >= 5%), platform (opsional), sisanya creator.
/// Alamat yang sama digabung, lalu diurutkan naik sesuai syarat kontrak.
export function buildBeneficiaries({ creator, protocolOwner, platform, platformShare = 0n, protocolShare = SCHEME.protocolShare }) {
  if (protocolShare < MIN_PROTOCOL_OWNER_SHARES) throw new Error("protocol share < 5%");
  const parts = [[protocolOwner, protocolShare]];
  if (platform && platformShare > 0n) parts.push([platform, platformShare]);
  const creatorShare = WAD - protocolShare - (platform ? platformShare : 0n);
  if (creatorShare <= 0n) throw new Error("creator share habis");
  parts.push([creator, creatorShare]);

  const merged = new Map();
  for (const [addr, shares] of parts) {
    const a = getAddress(addr);
    merged.set(a, (merged.get(a) || 0n) + shares);
  }
  return [...merged.entries()]
    .map(([beneficiary, shares]) => ({ beneficiary, shares }))
    .sort((x, y) => (BigInt(x.beneficiary) < BigInt(y.beneficiary) ? -1 : 1));
}

export function encodeTokenData({ name, symbol, tokenURI, creator, scheme = SCHEME }) {
  return coder.encode(
    ["string", "string", "tuple(uint64 cliff, uint64 duration)[]", "address[]", "uint256[]", "uint256[]", "string", "uint256", "uint48", "address", "address[]"],
    [name, symbol, [{ cliff: scheme.cliff, duration: scheme.duration }], [creator], [0n], [vestAmount(scheme)], tokenURI, 0n, 0n, ETH, []],
  );
}

export function encodePoolData({ beneficiaries, scheme = SCHEME }) {
  return coder.encode(
    ["tuple(uint24 fee, int24 tickSpacing, int24 farTick, tuple(int24 tickLower, int24 tickUpper, uint16 numPositions, uint256 shares)[] curves, tuple(address beneficiary, uint96 shares)[] beneficiaries, address dopplerHook, bytes onInitializationDopplerHookCalldata, bytes graduationDopplerHookCalldata)"],
    [{
      fee: scheme.lpFee,
      tickSpacing: scheme.tickSpacing,
      farTick: scheme.farTick,
      curves: [{ tickLower: scheme.tickLower, tickUpper: scheme.tickUpper, numPositions: scheme.numPositions, shares: WAD }],
      beneficiaries,
      dopplerHook: ETH,
      onInitializationDopplerHookCalldata: "0x",
      graduationDopplerHookCalldata: "0x",
    }],
  );
}

export function buildCreateParams({ name, symbol, tokenURI, creator, protocolOwner, platform, platformShare, salt, numeraire = ETH, addresses = ROBINHOOD, scheme = SCHEME }) {
  const beneficiaries = buildBeneficiaries({ creator, protocolOwner, platform, platformShare, protocolShare: scheme.protocolShare });
  return {
    initialSupply: scheme.supply,
    numTokensToSell: scheme.supply - vestAmount(scheme),
    numeraire,
    tokenFactory: addresses.tokenFactory,
    tokenFactoryData: encodeTokenData({ name, symbol, tokenURI, creator, scheme }),
    governanceFactory: addresses.governanceFactory,
    governanceFactoryData: "0x",
    poolInitializer: addresses.poolInitializer,
    poolInitializerData: encodePoolData({ beneficiaries, scheme }),
    liquidityMigrator: addresses.liquidityMigrator,
    liquidityMigratorData: "0x",
    integrator: platform || ETH,
    salt,
  };
}

// Init code minimal proxy solady (LibClone.initCode), dipakai DopplerERC20V1Factory.cloneDeterministic.
const cloneInitCodeHash = (implementation) =>
  keccak256(concat(["0x602c3d8160093d39f33d3d3d3d363d3d37363d73", implementation, "0x5af43d3d93803e602a57fd5bf3"]));

/// Alamat token = clone solady dari IMPLEMENTATION oleh factory, dengan salt dari CreateParams.
export function predictTokenAddress(implementation, salt, factory) {
  return getCreate2Address(factory, salt, cloneInitCodeHash(implementation));
}

/// Cari salt supaya alamat token berakhiran `suffix` (hex). Berjalan bertahap supaya UI tidak beku.
export async function mineVanitySalt({ implementation, factory, suffix, onProgress, signal, startNonce = BigInt(Date.now()) * 1_000_000n }) {
  const want = suffix.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{0,6}$/.test(want)) throw new Error("Suffix harus hex, maks 6 karakter");
  const initHash = cloneInitCodeHash(implementation);
  const prefix = concat(["0xff", factory]);
  let n = startNonce;
  for (let tried = 0; ; ) {
    for (let i = 0; i < 2_000; i++, tried++, n++) {
      const salt = zeroPadValue(toBeHex(n), 32);
      const addr = "0x" + keccak256(concat([prefix, salt, initHash])).slice(-40);
      if (addr.endsWith(want)) return { salt, address: getAddress(addr), tried };
    }
    if (signal?.aborted) throw new Error("Dibatalkan");
    onProgress?.(tried);
    await new Promise((r) => setTimeout(r, 0));
  }
}

/// PoolId Uniswap v4 = keccak256(abi.encode(PoolKey)). Hook = initializer, fee statis (tanpa Doppler hook).
export function poolIdFor(asset, { numeraire = ETH, initializer = ROBINHOOD.poolInitializer, scheme = SCHEME } = {}) {
  const [c0, c1] = BigInt(asset) < BigInt(numeraire) ? [asset, numeraire] : [numeraire, asset];
  return keccak256(coder.encode(["address", "address", "uint24", "int24", "address"], [c0, c1, scheme.lpFee, scheme.tickSpacing, initializer]));
}

