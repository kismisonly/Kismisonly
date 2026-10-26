import React, { useCallback, useEffect, useRef, useState } from "react";
import { BrowserProvider, Contract, ZeroAddress, formatEther, formatUnits, hexlify, isAddress, randomBytes, toQuantity } from "ethers";
import { config, shares } from "./config.js";
import {
  ROBINHOOD, SCHEME, WAD, airlockAbi, buildCreateParams, dopplerTokenAbi, initializerAbi, mineVanitySalt, poolIdFor,
  predictTokenAddress, tokenFactoryAbi, vestAmount,
} from "./doppler.js";

const PAGES = ["Home", "Launch", "Claim fees", "How it works"];
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 6 });
const tokens = (wei) => fmt(formatUnits(wei, 18));
const errMsg = (e) => e?.shortMessage || e?.reason || e?.info?.error?.message || e?.message || String(e);
const supplyNum = Number(SCHEME.supply / WAD);
const vestPct = Number(SCHEME.vestBps) / 100;
const cliffDays = Number(SCHEME.cliff / 86_400n);
const vestDays = Number(SCHEME.duration / 86_400n);
const feePct = SCHEME.lpFee / 10_000;

function useWallet() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    eth.request({ method: "eth_accounts" }).then((a) => setAccount(a[0] || "")).catch(() => {});
    eth.request({ method: "eth_chainId" }).then((c) => setChainId(Number(c))).catch(() => {});
    const onAcc = (a) => setAccount(a[0] || "");
    const onChain = (c) => setChainId(Number(c));
    eth.on?.("accountsChanged", onAcc);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAcc);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) throw new Error("Wallet tidak ditemukan. Pasang MetaMask / Rabby dulu.");
    const a = await window.ethereum.request({ method: "eth_requestAccounts" });
    setAccount(a[0] || "");
    return a[0];
  }, []);

  const signer = useCallback(async () => {
    if (!window.ethereum) throw new Error("Wallet tidak ditemukan.");
    const current = Number(await window.ethereum.request({ method: "eth_chainId" }));
    if (current !== config.chainId) {
      const hex = toQuantity(config.chainId);
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
      } catch (e) {
        if (e?.code !== 4902) throw e;
        if (!config.rpcUrl) throw new Error(`Tambahkan ${config.chainName} (chain ${config.chainId}) ke wallet dulu.`);
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: hex, chainName: config.chainName, rpcUrls: [config.rpcUrl],
            nativeCurrency: { name: config.nativeSymbol, symbol: config.nativeSymbol, decimals: 18 },
            blockExplorerUrls: [config.explorer],
          }],
        });
      }
    }
    return new BrowserProvider(window.ethereum).getSigner();
  }, []);

  return { account, chainId, connect, signer };
}

function Link({ kind, v }) {
  if (!v) return <b>—</b>;
  return <a href={`${config.explorer}/${kind}/${v}`} target="_blank" rel="noreferrer">{short(v)}</a>;
}

function SchemeCard() {
  return (
    <aside className="side">
      <div className="card accent">
        <div className="eyebrow dark">Skema tetap</div>
        <h3>{vestPct}% creator vest</h3>
        <ul>
          <li>{fmt(supplyNum)} supply, DopplerERC20V1</li>
          <li>{100 - vestPct}% → pool Uniswap v4, terkunci</li>
          <li>{vestPct}% → vesting di dalam token: cliff {cliffDays} hari, linear {vestDays} hari</li>
          <li>Wallet kamu yang menandatangani Airlock.create</li>
        </ul>
      </div>
      <div className="card">
        <h4>Fee swap {feePct}%</h4>
        <p className="muted">
          Diambil dari setiap swap, bukan dari supply. Dibagi ke beneficiaries pool:
          <b> {shares.creator}% creator</b>{shares.platform > 0 && <> / {shares.platform}% platform</>} / {shares.protocol}% Doppler
          (wajib dari protokol). Klaim kapan saja di Claim fees.
        </p>
      </div>
    </aside>
  );
}

function Home({ go }) {
  return (
    <section className="hero">
      <div className="eyebrow">Doppler · {config.chainName}</div>
      <h1>Launch token dengan vesting dan fee share bawaan.</h1>
      <p className="lead">
        Satu transaksi ke Airlock Doppler resmi: token {fmt(supplyNum)} supply, {100 - vestPct}% langsung ke pool,
        {" "}{vestPct}% vesting creator, dan {shares.creator}% fee swap mengalir ke wallet kamu.
      </p>
      <div className="row">
        <button className="btn primary" onClick={() => go("Launch")}>Launch token</button>
        <button className="btn ghost" onClick={() => go("How it works")}>Cara kerja</button>
      </div>
      <div className="stats">
        <div><b>{100 - vestPct}%</b><span>ke pool</span></div>
        <div><b>{vestPct}%</b><span>vesting creator</span></div>
        <div><b>{shares.creator}%</b><span>fee ke creator</span></div>
        <div><b>0%</b><span>pajak transfer</span></div>
      </div>
    </section>
  );
}

async function compressImage(file) {
  const img = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const side = Math.min(img.width, img.height);
  canvas.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.75);
}

function Launch({ wallet }) {
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ name: "", symbol: "", description: "", image: "", creator: "" });
  const [status, setStatus] = useState({ kind: "", msg: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const abort = useRef(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const creator = f.creator || wallet.account;
  const step1Ok = f.name.trim() && f.symbol.trim() && f.symbol.length <= 12;
  const step2Ok = isAddress(creator || "");

  async function onImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setF({ ...f, image: await compressImage(file) });
    } catch (err) {
      setStatus({ kind: "err", msg: "Gambar tidak bisa dibaca: " + errMsg(err) });
    }
  }

  async function submit() {
    setResult(null);
    setBusy(true);
    try {
      if (!wallet.account) await wallet.connect();
      const s = await wallet.signer();
      const airlock = new Contract(ROBINHOOD.airlock, airlockAbi, s);
      const factory = new Contract(ROBINHOOD.tokenFactory, tokenFactoryAbi, s);
      setStatus({ kind: "info", msg: "Membaca kontrak Doppler…" });
      const [protocolOwner, implementation] = await Promise.all([airlock.owner(), factory.IMPLEMENTATION()]);

      let salt = hexlify(randomBytes(32));
      if (config.vanitySuffix) {
        abort.current = new AbortController();
        const found = await mineVanitySalt({
          implementation, factory: ROBINHOOD.tokenFactory, suffix: config.vanitySuffix, signal: abort.current.signal,
          onProgress: (n) => setStatus({ kind: "info", msg: `Mencari alamat …${config.vanitySuffix}: ${fmt(n)} percobaan` }),
        });
        salt = found.salt;
      }
      const predicted = predictTokenAddress(implementation, salt, ROBINHOOD.tokenFactory);

      const meta = { name: f.name.trim(), symbol: f.symbol.trim(), description: f.description.trim(), image: f.image.trim() };
      const tokenURI = "data:application/json;base64," + btoa(unescape(encodeURIComponent(JSON.stringify(meta))));
      const params = buildCreateParams({
        name: meta.name, symbol: meta.symbol, tokenURI, creator, protocolOwner, salt,
        platform: config.platform || undefined, platformShare: (BigInt(config.platformBps) * WAD) / 10_000n,
      });

      // Simulasi gratis di chain asli: kalau ada parameter yang ditolak kontrak, berhenti di sini.
      setStatus({ kind: "info", msg: "Simulasi Airlock.create…" });
      const sim = await airlock.create.staticCall(params);
      if (sim.asset.toLowerCase() !== predicted.toLowerCase()) {
        throw new Error(`Alamat simulasi ${sim.asset} ≠ prediksi ${predicted}. Dibatalkan demi keamanan.`);
      }

      setStatus({ kind: "info", msg: "Konfirmasi transaksi di wallet…" });
      const tx = await airlock.create(params);
      setStatus({ kind: "info", msg: "Menunggu konfirmasi on-chain…" });
      await tx.wait();
      setResult({ hash: tx.hash, token: sim.asset, poolId: poolIdFor(sim.asset) });
      setStatus({ kind: "ok", msg: "Token berhasil di-launch." });
    } catch (e) {
      setStatus({ kind: "err", msg: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="split">
      <div>
        <div className="eyebrow">Create · Doppler Airlock</div>
        <h1>Deploy token kamu</h1>
        <p className="lead">
          Nama, ticker, gambar, deskripsi, dan wallet creator diatur oleh kamu. Pembagian supply, pool, dan fee
          mengikuti skema tetap. Wallet kamu yang menandatangani <code>Airlock.create</code>
          {config.vanitySuffix && <>; alamat token berakhiran <code>…{config.vanitySuffix}</code></>}.
        </p>
        <div className="card form">
          <div className="steps">
            <button className={step === 1 ? "on" : ""} onClick={() => setStep(1)}>1. Token</button>
            <button className={step === 2 ? "on" : ""} disabled={!step1Ok} onClick={() => setStep(2)}>2. Launch</button>
          </div>

          {step === 1 && (
            <>
              <h3>Token kamu</h3>
              <div className="upload">
                <label className="drop">
                  {f.image ? <img src={f.image} alt="" /> : "Upload"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onImage} hidden />
                </label>
                <div>
                  <b>Gambar token</b>
                  <div className="muted small">JPG/PNG persegi, dikompres ke 256px dan disimpan on-chain di metadata</div>
                </div>
              </div>
              <label>Nama<input value={f.name} onChange={set("name")} placeholder="Kismis Token" /></label>
              <label>Ticker <small>maks 12 karakter</small>
                <input value={f.symbol} maxLength={12} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} placeholder="KSM" />
              </label>
              <label>Deskripsi <small>opsional</small>
                <textarea value={f.description} onChange={set("description")} placeholder="Satu kalimat untuk halaman chart." />
              </label>
              <button className="btn primary wide" disabled={!step1Ok} onClick={() => setStep(2)}>Lanjut</button>
            </>
          )}

          {step === 2 && (
            <>
              <h3>Launch</h3>
              <label>Wallet creator <small>menerima vesting {vestPct}% + {shares.creator}% fee</small>
                <input value={f.creator} onChange={set("creator")} placeholder={wallet.account || "0x… (default: wallet terhubung)"} />
              </label>
              {creator && !isAddress(creator) && <div className="hint err">Alamat tidak valid.</div>}
              <div className="summary">
                <div><span>Token</span><b>{f.name} (${f.symbol})</b></div>
                <div><span>Ke pool</span><b>{tokens(SCHEME.supply - vestAmount())}</b></div>
                <div><span>Vesting creator</span><b>{tokens(vestAmount())}</b></div>
                <div><span>Fee swap</span><b>{feePct}%</b></div>
                <div><span>Creator</span><b>{short(creator) || "—"}</b></div>
                <div><span>Jaringan</span><b>{config.chainName} ({config.chainId})</b></div>
              </div>
              <button className="btn primary wide" disabled={busy || !step2Ok} onClick={submit}>
                {busy ? "Memproses…" : wallet.account ? "Launch token" : "Connect wallet & launch"}
              </button>
              {busy && config.vanitySuffix && (
                <button className="btn ghost wide" onClick={() => abort.current?.abort()}>Batalkan pencarian alamat</button>
              )}
            </>
          )}

          {status.msg && <div className={`hint ${status.kind}`}>{status.msg}</div>}
          {result && (
            <div className="summary">
              <div><span>Token</span><Link kind="address" v={result.token} /></div>
              <div><span>Tx</span><Link kind="tx" v={result.hash} /></div>
              <div><span>Pool ID</span><b title={result.poolId}>{short(result.poolId)}</b></div>
            </div>
          )}
        </div>
      </div>
      <SchemeCard />
    </section>
  );
}

function Claim({ wallet }) {
  const [token, setToken] = useState("");
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState({ kind: "", msg: "" });

  async function load(keepStatus = false) {
    if (!keepStatus) setInfo(null);
    try {
      if (!wallet.account) await wallet.connect();
      const s = await wallet.signer();
      const me = await s.getAddress();
      const poolId = poolIdFor(token);
      const init = new Contract(ROBINHOOD.poolInitializer, initializerAbi, s);
      const tok = new Contract(token, dopplerTokenAbi, s);
      const [symbol, myShares, vested] = await Promise.all([tok.symbol(), init.getShares(poolId, me), tok.computeAvailableVestedAmount(me)]);
      let preview = null;
      if (myShares > 0n) {
        // Perkiraan: fee baru di pool sejak koleksi terakhir × porsi kamu.
        const [f0, f1] = await init.collectFees.staticCall(poolId).catch(() => [0n, 0n]);
        preview = { eth: (f0 * myShares) / WAD, token: (f1 * myShares) / WAD };
      }
      setInfo({ me, poolId, symbol, myShares, vested, preview });
      if (!keepStatus) setStatus({ kind: "", msg: "" });
    } catch (e) {
      setStatus({ kind: "err", msg: errMsg(e) });
    }
  }

  async function send(fn) {
    try {
      setStatus({ kind: "info", msg: "Konfirmasi di wallet…" });
      const tx = await fn(await wallet.signer());
      await tx.wait();
      setStatus({ kind: "ok", msg: "Berhasil." });
      await load(true);
    } catch (e) {
      setStatus({ kind: "err", msg: errMsg(e) });
    }
  }

  return (
    <section className="narrow">
      <div className="eyebrow">Claim fees</div>
      <h1>Klaim fee & vesting</h1>
      <p className="lead">Masukkan alamat token yang di-launch dengan skema ini.</p>
      <div className="card form">
        <label>Alamat token<input value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="0x…" /></label>
        <button className="btn primary wide" disabled={!isAddress(token)} onClick={() => load()}>Cek</button>
        {info && (
          <>
            <div className="summary">
              <div><span>Token</span><b>${info.symbol}</b></div>
              <div><span>Porsi fee kamu</span><b>{fmt(Number(formatUnits(info.myShares, 16)))}%</b></div>
              {info.preview && <div><span>Perkiraan fee {config.nativeSymbol}</span><b>{formatEther(info.preview.eth)}</b></div>}
              {info.preview && <div><span>Perkiraan fee ${info.symbol}</span><b>{tokens(info.preview.token)}</b></div>}
            </div>
            <button className="btn ghost wide" disabled={info.myShares === 0n}
              onClick={() => send((s) => new Contract(ROBINHOOD.poolInitializer, initializerAbi, s).collectFees(info.poolId))}>
              {info.myShares === 0n ? "Wallet ini bukan beneficiary" : "Klaim fee"}
            </button>
            <h4>Vesting</h4>
            <div className="summary">
              <div><span>Bisa dirilis sekarang</span><b>{tokens(info.vested)}</b></div>
            </div>
            <button className="btn ghost wide" disabled={info.vested === 0n}
              onClick={() => send((s) => new Contract(token, dopplerTokenAbi, s).release(info.vested))}>
              Rilis vesting
            </button>
          </>
        )}
        {status.msg && <div className={`hint ${status.kind}`}>{status.msg}</div>}
      </div>
    </section>
  );
}

function How() {
  return (
    <section className="narrow">
      <div className="eyebrow">How it works</div>
      <h1>Satu transaksi ke Doppler</h1>
      <ol className="flow">
        <li><b>Token.</b> Airlock membuat DopplerERC20V1 {fmt(supplyNum)} supply lewat factory resmi.</li>
        <li><b>Vesting.</b> {vestPct}% dikunci di dalam kontrak token: 0 sebelum {cliffDays} hari, lalu rilis linear sampai {vestDays} hari.</li>
        <li><b>Pool.</b> {100 - vestPct}% jadi likuiditas Uniswap v4 (pasangan {config.nativeSymbol}) lewat DopplerHookInitializer, langsung dikunci.</li>
        <li><b>Fee.</b> Setiap swap kena {feePct}% fee: {shares.creator}% creator{shares.platform > 0 && `, ${shares.platform}% platform`}, {shares.protocol}% Doppler.</li>
        <li><b>Klaim.</b> Beneficiary memanggil <code>collectFees</code> kapan saja untuk menarik bagiannya.</li>
      </ol>
      <div className="card">
        <h4>Kontrak yang dipanggil ({config.chainName})</h4>
        <div className="summary">
          <div><span>Airlock</span><Link kind="address" v={ROBINHOOD.airlock} /></div>
          <div><span>DopplerERC20V1Factory</span><Link kind="address" v={ROBINHOOD.tokenFactory} /></div>
          <div><span>DopplerHookInitializer</span><Link kind="address" v={ROBINHOOD.poolInitializer} /></div>
          <div><span>NoOpGovernanceFactory</span><Link kind="address" v={ROBINHOOD.governanceFactory} /></div>
          <div><span>NoOpMigrator</span><Link kind="address" v={ROBINHOOD.liquidityMigrator} /></div>
        </div>
        <p className="muted small">Alamat dari daftar kontrak resmi Doppler. Sebelum minta tanda tangan, website mensimulasikan transaksi di chain asli.</p>
      </div>
    </section>
  );
}

export default function App() {
  const [page, setPage] = useState("Launch");
  const wallet = useWallet();
  const [connErr, setConnErr] = useState("");
  const wrongChain = wallet.account && wallet.chainId && wallet.chainId !== config.chainId;

  return (
    <div className="app">
      <header className="nav">
        <div className="brand"><span className="logo">K</span>Kismis</div>
        <nav>
          {PAGES.map((p) => (
            <button key={p} className={page === p ? "on" : ""} onClick={() => setPage(p)}>{p}</button>
          ))}
        </nav>
        <div className="wallet">
          <span className="muted small">{config.chainName}</span>
          <button className="btn primary sm" onClick={() => wallet.connect().catch((e) => setConnErr(errMsg(e)))}>
            {wallet.account ? short(wallet.account) : "Connect"}
          </button>
        </div>
      </header>
      {connErr && <div className="notice">{connErr}</div>}
      {wrongChain && <div className="notice">Wallet di jaringan lain. Akan diminta pindah ke {config.chainName} saat transaksi.</div>}
      <main>
        {page === "Home" && <Home go={setPage} />}
        {page === "Launch" && <Launch wallet={wallet} />}
        {page === "Claim fees" && <Claim wallet={wallet} />}
        {page === "How it works" && <How />}
      </main>
      <footer className="muted small">Memakai kontrak Doppler resmi. Website ini bukan bagian dari Doppler atau Bankr.</footer>
    </div>
  );
}
