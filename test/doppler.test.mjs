// Memverifikasi encoder Airlock.create di web/src/doppler.js terhadap aturan kontrak Doppler
// (lewat DopplerEncodingHarness) dan prediksi alamat token terhadap solady LibClone.
import assert from "node:assert";
import fs from "node:fs";
import ganache from "ganache";
import { ethers } from "ethers";
import {
  ROBINHOOD, SCHEME, WAD, buildCreateParams, encodePoolData, mineVanitySalt, poolIdFor, predictTokenAddress, vestAmount,
} from "../web/src/doppler.js";

const art = JSON.parse(fs.readFileSync("build/DopplerEncodingHarness.json"));
const provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true } }));
const signer = await provider.getSigner(0);
const h = await new ethers.ContractFactory(art.abi, art.bytecode, signer).deploy();
await h.waitForDeployment();

const rand = () => ethers.Wallet.createRandom().address;
const impl = rand();
const base = { name: "Kismis", symbol: "KSM", tokenURI: "ipfs://meta" };

const cases = [
  { label: "creator + platform 5%", creator: rand(), protocolOwner: rand(), platform: rand(), platformShare: WAD / 20n },
  { label: "tanpa platform", creator: rand(), protocolOwner: rand() },
  { label: "creator = platform (digabung)", same: "platform", protocolOwner: rand(), platformShare: WAD / 20n },
  { label: "creator = protocol owner (digabung)", same: "protocol", platform: rand(), platformShare: WAD / 10n },
];

for (const c of cases) {
  const creator = c.creator || rand();
  const args = { ...base, creator, protocolOwner: c.same === "protocol" ? creator : c.protocolOwner, platform: c.same === "platform" ? creator : c.platform, platformShare: c.platformShare };
  for (let i = 0; i < 25; i++) {
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const p = buildCreateParams({ ...args, salt });
    const asset = predictTokenAddress(impl, salt, ROBINHOOD.tokenFactory);
    assert.equal(asset, await h.predict(impl, salt, ROBINHOOD.tokenFactory), "prediksi alamat = LibClone");
    const [vested, onchainCreator] = await h.validate(p, args.protocolOwner, asset);
    assert.equal(vested, vestAmount());
    assert.equal(onchainCreator, ethers.getAddress(creator));
  }
  console.log(`ok  ${c.label}: 25 salt acak lolos semua aturan Doppler`);
}

// Pembagian fee yang diharapkan: 5% protokol, 5% platform, 90% creator.
{
  const creator = rand(), protocolOwner = rand(), platform = rand();
  const p = buildCreateParams({ ...base, creator, protocolOwner, platform, platformShare: WAD / 20n, salt: ethers.ZeroHash });
  const [d] = ethers.AbiCoder.defaultAbiCoder().decode(
    ["tuple(uint24,int24,int24,tuple(int24,int24,uint16,uint256)[],tuple(address,uint96)[],address,bytes,bytes)"], p.poolInitializerData);
  const shares = Object.fromEntries(d[4].map(([a, s]) => [a, s]));
  assert.equal(shares[ethers.getAddress(protocolOwner)], WAD / 20n);
  assert.equal(shares[ethers.getAddress(platform)], WAD / 20n);
  assert.equal(shares[ethers.getAddress(creator)], (WAD * 90n) / 100n);
  assert.equal(p.numTokensToSell, (SCHEME.supply * 85n) / 100n);
  console.log("ok  fee: 90% creator / 5% platform / 5% Doppler, pool 85% supply");
}

// Harness harus menolak data yang salah (bukti validasinya bekerja).
{
  const creator = rand(), protocolOwner = rand();
  const good = buildCreateParams({ ...base, creator, protocolOwner, salt: ethers.ZeroHash });
  const unsorted = [{ beneficiary: "0xffffffffffffffffffffffffffffffffffffffff", shares: WAD / 2n }, { beneficiary: protocolOwner, shares: WAD / 2n }];
  await assert.rejects(h.validate({ ...good, poolInitializerData: encodePoolData({ beneficiaries: unsorted }) }, protocolOwner, rand()));
  const noOwner = [{ beneficiary: ethers.getAddress(creator), shares: WAD }];
  await assert.rejects(h.validate({ ...good, poolInitializerData: encodePoolData({ beneficiaries: noOwner }) }, protocolOwner, rand()));
  await assert.rejects(h.validate({ ...good, poolInitializerData: encodePoolData({ beneficiaries: [{ beneficiary: protocolOwner, shares: WAD }], scheme: { ...SCHEME, tickLower: -239_450 } }) }, protocolOwner, rand()));
  console.log("ok  harness menolak: urutan salah, tanpa protocol owner, tick tidak selaras");
}

// Vanity: salt hasil mining menghasilkan alamat berakhiran suffix, dan cocok dengan LibClone.
{
  const { salt, address, tried } = await mineVanitySalt({ implementation: impl, factory: ROBINHOOD.tokenFactory, suffix: "ba3" });
  assert.ok(address.toLowerCase().endsWith("ba3"));
  assert.equal(address, await h.predict(impl, salt, ROBINHOOD.tokenFactory));
  console.log(`ok  vanity …ba3 ketemu setelah ${tried} percobaan, cocok dengan LibClone`);
}

// PoolId deterministik dan berbeda per token.
assert.notEqual(poolIdFor(rand()), poolIdFor(rand()));
console.log("SEMUA TES DOPPLER LULUS");
