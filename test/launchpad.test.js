// Test end-to-end di ganache: launch, cek alokasi supply, vesting, dev buy, dan pembagian fee.
const assert = require("assert");
const fs = require("fs");
const ganache = require("ganache");
const { ethers } = require("ethers");

const art = (n) => JSON.parse(fs.readFileSync(`build/${n}.json`));
const DAY = 86400;

async function main() {
  const provider = new ethers.BrowserProvider(ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 4 } }));
  const [owner, creator, treasury, trader] = await Promise.all([0, 1, 2, 3].map((i) => provider.getSigner(i)));
  const deploy = async (n, signer, ...args) => {
    const a = art(n);
    const c = await new ethers.ContractFactory(a.abi, a.bytecode, signer).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const at = (n, addr, s = owner) => new ethers.Contract(addr, art(n).abi, s);
  const time = async (s) => { await provider.send("evm_increaseTime", [s]); await provider.send("evm_mine", []); };

  const supply = ethers.parseEther("100000000000");
  const launcher = await deploy("MockLauncher", owner);
  const config = {
    totalSupply: supply, vestBps: 1500, vestCliff: 30 * DAY, vestDuration: 365 * DAY,
    platformFeeBps: 4000, platformTreasury: await treasury.getAddress(),
  };
  const pad = await deploy("Launchpad", owner, await owner.getAddress(), await launcher.getAddress(), config);

  const creatorAddr = await creator.getAddress();
  const params = {
    name: "Kismis", symbol: "KSM", uri: "ipfs://x", creator: creatorAddr, salt: ethers.id("ksm"),
    poolData: "0x", devBuyMinOut: 0, seedValue: 0,
  };
  const devBuy = 1000n;
  const tx = await pad.connect(creator).launch(params, { value: devBuy });
  await tx.wait();
  const tokenAddr = await pad.allTokens(0);
  const info = await pad.launches(tokenAddr);
  const token = at("LaunchToken", tokenAddr);

  // Alokasi supply
  assert.equal(await token.totalSupply(), supply);
  assert.equal(await token.balanceOf(info.vesting), (supply * 15n) / 100n, "15% ke vesting");
  assert.equal(await token.balanceOf(await pad.getAddress()), 0n, "launchpad tidak pegang sisa");
  assert.equal(await token.balanceOf(creatorAddr), devBuy * 1000n, "dev buy langsung ke creator");
  assert.equal(await launcher.feeRecipientOf(tokenAddr), info.feeSplitter);
  console.log("ok  supply: 85% pool, 15% vesting, dev buy ke creator");

  // Vesting
  const vest = at("CreatorVesting", info.vesting);
  assert.equal(await vest.releasable(), 0n);
  await assert.rejects(vest.release()); // revert: nothing to release
  await time(31 * DAY);
  assert.ok((await vest.releasable()) > 0n, "setelah cliff ada yang bisa dirilis");
  await time(400 * DAY);
  // gasLimit manual: estimateGas ganache tidak ikut evm_increaseTime.
  await (await vest.release({ gasLimit: 200000 })).wait();
  assert.equal(await token.balanceOf(info.vesting), 0n);
  console.log("ok  vesting: 0 sebelum cliff, linear, habis setelah 1 tahun");

  // Fee splitter: kirim 1 ETH fee, creator 60% / treasury 40%
  const splitter = at("FeeSplitter", info.feeSplitter);
  await (await trader.sendTransaction({ to: info.feeSplitter, value: ethers.parseEther("1") })).wait();
  const tAddr = await treasury.getAddress();
  assert.equal(await splitter.pending(ethers.ZeroAddress, creatorAddr), ethers.parseEther("0.6"));
  assert.equal(await splitter.pending(ethers.ZeroAddress, tAddr), ethers.parseEther("0.4"));
  await (await splitter.claim(ethers.ZeroAddress, tAddr)).wait();
  await (await trader.sendTransaction({ to: info.feeSplitter, value: ethers.parseEther("1") })).wait();
  assert.equal(await splitter.pending(ethers.ZeroAddress, creatorAddr), ethers.parseEther("1.2"));
  assert.equal(await splitter.pending(ethers.ZeroAddress, tAddr), ethers.parseEther("0.4"));
  console.log("ok  fee: 60/40 tetap benar walau klaim bergantian");

  // Config baru tidak mengubah token lama
  await (await pad.setConfig({ ...config, platformFeeBps: 5000 })).wait();
  assert.equal(await splitter.shares(1), 4000n);
  await assert.rejects(pad.setConfig({ ...config, vestBps: 2500 })); // revert: vest too high
  await assert.rejects(pad.connect(creator).setConfig(config));
  console.log("ok  config: token lama terkunci, batas & onlyOwner jalan");
}

main().then(() => console.log("SEMUA TES LULUS")).catch((e) => { console.error(e); process.exit(1); });
