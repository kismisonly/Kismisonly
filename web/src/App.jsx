import React, { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract, ZeroAddress, formatEther, formatUnits, hexlify, isAddress, parseEther, randomBytes, toQuantity } from "ethers";
import { config, isConfigured, scheme } from "./config.js";
import { erc20Abi, launchpadAbi, splitterAbi, vestingAbi } from "./abi.js";

const PAGES = ["Home", "Launch", "Claim fees", "How it works"];
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const fmt = (n) => Number(n).toLocaleString("en-US");
const explorerLink = (kind, v) => (config.explorer ? `${config.explorer}/${kind}/${v}` : null);
const errMsg = (e) => e?.shortMessage || e?.reason || e?.info?.error?.message || e?.message || String(e);

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
  }, []);

  const ensureChain = useCallback(async () => {
    if (!config.chainId || chainId === config.chainId) return;
    const hex = toQuantity(config.chainId);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if (e?.code !== 4902 || !config.rpcUrl) throw e;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hex,
          chainName: config.chainName,
          rpcUrls: [config.rpcUrl],
          nativeCurrency: { name: config.nativeSymbol, symbol: config.nativeSymbol, decimals: 18 },
          blockExplorerUrls: config.explorer ? [config.explorer] : [],
        }],
      });
    }
  }, [chainId]);

  const signer = useCallback(async () => {
    await ensureChain();
    return new BrowserProvider(window.ethereum).getSigner();
  }, [ensureChain]);

  return { account, chainId, connect, signer };
}

function NotConfigured() {
  if (isConfigured) return null;
  return (
    <div className="notice">
      Kontrak Launchpad belum di-deploy / belum diset. Isi <code>VITE_LAUNCHPAD_ADDRESS</code> dan{" "}
      <code>VITE_CHAIN_ID</code> di environment Vercel. Sampai itu, transaksi dinonaktifkan.
    </div>
  );
}

function SchemeCard() {
  return (
    <aside className="side">
      <div className="card accent">
        <div className="eyebrow dark">Skema tetap</div>
        <h3>{scheme.vestPct}% creator vest</h3>
        <ul>
          <li>{fmt(scheme.supply)} supply, mint sekali</li>
          <li>{scheme.poolPct}% → pool, LP terkunci</li>
          <li>{scheme.vestPct}% → vesting: cliff {scheme.cliffDays} hari, linear {scheme.vestDays} hari</li>
          <li>Penerima vesting tidak bisa diganti</li>
        </ul>
      </div>
      <div className="card">
        <h4>Fee swap</h4>
        <p className="muted">
          Fee diambil dari setiap swap di pool, bukan dari supply. Token tidak punya pajak transfer. Bagian beneficiary
          masuk ke FeeSplitter token kamu: <b>{scheme.creatorFeePct}% creator</b> / {scheme.platformFeePct}% platform,
          dikunci saat launch. Klaim kapan saja di halaman Claim fees.
        </p>
      </div>
    </aside>
  );
}

function Home({ go }) {
  return (
    <section className="hero">
      <div className="eyebrow">Launchpad · {config.chainName}</div>
      <h1>Launch token dengan vesting dan fee share bawaan.</h1>
      <p className="lead">
        Satu transaksi: token {fmt(scheme.supply)} supply, {scheme.poolPct}% langsung ke pool, {scheme.vestPct}% ke
        vesting creator, dan fee swap mengalir ke wallet kamu.
      </p>
      <div className="row">
        <button className="btn primary" onClick={() => go("Launch")}>Launch token</button>
        <button className="btn ghost" onClick={() => go("How it works")}>Cara kerja</button>
      </div>
      <div className="stats">
        <div><b>{scheme.poolPct}%</b><span>ke pool</span></div>
        <div><b>{scheme.vestPct}%</b><span>vesting creator</span></div>
        <div><b>{scheme.creatorFeePct}%</b><span>fee ke creator</span></div>
        <div><b>0%</b><span>pajak transfer</span></div>
      </div>
    </section>
  );
}

function Launch({ wallet }) {
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ name: "", symbol: "", description: "", image: "", creator: "", devBuy: "" });
  const [status, setStatus] = useState({ kind: "", msg: "" });
  const [result, setResult] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const creator = f.creator || wallet.account;
  const step1Ok = f.name.trim() && f.symbol.trim() && f.symbol.length <= 12;
  const step2Ok = isAddress(creator || "") && (!f.devBuy || Number(f.devBuy) >= 0);

  async function submit() {
    setResult(null);
    try {
      if (!wallet.account) await wallet.connect();
      setStatus({ kind: "info", msg: "Konfirmasi transaksi di wallet…" });
      const s = await wallet.signer();
      const pad = new Contract(config.launchpad, launchpadAbi, s);
      const meta = { name: f.name.trim(), symbol: f.symbol.trim(), description: f.description.trim(), image: f.image.trim() };
      const uri = "data:application/json;base64," + btoa(unescape(encodeURIComponent(JSON.stringify(meta))));
      const params = {
        name: meta.name,
        symbol: meta.symbol,
        uri,
        creator: creator,
        salt: hexlify(randomBytes(32)),
        poolData: "0x",
        devBuyMinOut: 0,
        seedValue: 0,
      };
      const value = f.devBuy ? parseEther(f.devBuy) : 0n;
      const tx = await pad.launch(params, { value });
      setStatus({ kind: "info", msg: "Menunggu konfirmasi on-chain…" });
      const rc = await tx.wait();
      const ev = rc.logs.map((l) => { try { return pad.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "Launched");
      setResult({ hash: tx.hash, token: ev?.args.token, vesting: ev?.args.vesting, splitter: ev?.args.feeSplitter });
      setStatus({ kind: "ok", msg: "Token berhasil di-launch." });
    } catch (e) {
      setStatus({ kind: "err", msg: errMsg(e) });
    }
  }

  return (
    <section className="split">
      <div>
        <div className="eyebrow">Create · Launchpad</div>
        <h1>Deploy token kamu</h1>
        <p className="lead">
          Nama, ticker, gambar, deskripsi, dan wallet creator diatur oleh kamu. Pembagian supply dan fee mengikuti
          skema tetap launchpad. Wallet kamu yang menandatangani <code>Launchpad.launch</code>.
        </p>
        <NotConfigured />
        <div className="card form">
          <div className="steps">
            <button className={step === 1 ? "on" : ""} onClick={() => setStep(1)}>1. Token</button>
            <button className={step === 2 ? "on" : ""} disabled={!step1Ok} onClick={() => setStep(2)}>2. Launch</button>
          </div>

          {step === 1 && (
            <>
              <h3>Token kamu</h3>
              <label>Nama<input value={f.name} onChange={set("name")} placeholder="Kismis Token" /></label>
              <label>Ticker <small>maks 12 karakter</small>
                <input value={f.symbol} maxLength={12} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} placeholder="KSM" />
              </label>
              <label>URL gambar <small>opsional, persegi</small>
                <input value={f.image} onChange={set("image")} placeholder="https://… atau ipfs://…" />
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
              <label>Wallet creator <small>menerima vesting {scheme.vestPct}% + {scheme.creatorFeePct}% fee</small>
                <input value={f.creator} onChange={set("creator")} placeholder={wallet.account || "0x… (default: wallet terhubung)"} />
              </label>
              {creator && !isAddress(creator) && <div className="hint err">Alamat tidak valid.</div>}
              <label>Dev buy <small>opsional, {config.nativeSymbol}. Token langsung ke creator, tidak di-vesting</small>
                <input value={f.devBuy} onChange={set("devBuy")} placeholder="0" inputMode="decimal" />
              </label>
              <div className="summary">
                <div><span>Token</span><b>{f.name} (${f.symbol})</b></div>
                <div><span>Ke pool</span><b>{fmt(scheme.supply * scheme.poolPct / 100)}</b></div>
                <div><span>Vesting creator</span><b>{fmt(scheme.supply * scheme.vestPct / 100)}</b></div>
                <div><span>Creator</span><b>{short(creator) || "—"}</b></div>
              </div>
              <button className="btn primary wide" disabled={!isConfigured || !step2Ok} onClick={submit}>
                {wallet.account ? "Launch token" : "Connect wallet & launch"}
              </button>
            </>
          )}

          {status.msg && <div className={`hint ${status.kind}`}>{status.msg}</div>}
          {result && (
            <div className="summary">
              <div><span>Token</span><Addr kind="address" v={result.token} /></div>
              <div><span>Vesting</span><Addr kind="address" v={result.vesting} /></div>
              <div><span>FeeSplitter</span><Addr kind="address" v={result.splitter} /></div>
              <div><span>Tx</span><Addr kind="tx" v={result.hash} /></div>
            </div>
          )}
        </div>
      </div>
      <SchemeCard />
    </section>
  );
}

function Addr({ kind, v }) {
  if (!v) return <b>—</b>;
  const href = explorerLink(kind, v);
  return href ? <a href={href} target="_blank" rel="noreferrer">{short(v)}</a> : <b title={v}>{short(v)}</b>;
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
      const pad = new Contract(config.launchpad, launchpadAbi, s);
      const l = await pad.launches(token);
      if (l.token === ZeroAddress) throw new Error("Token ini bukan hasil launchpad ini.");
      const me = await s.getAddress();
      const split = new Contract(l.feeSplitter, splitterAbi, s);
      const vest = new Contract(l.vesting, vestingAbi, s);
      const erc = new Contract(l.token, erc20Abi, s);
      const [symbol, ethPending, tokPending, releasable, released, total, start, cliff] = await Promise.all([
        erc.symbol(), split.pending(ZeroAddress, me), split.pending(l.token, me),
        vest.releasable(), vest.released(), vest.totalAllocation(), vest.start(), vest.cliff(),
      ]);
      setInfo({ l, me, symbol, ethPending, tokPending, releasable, released, total, cliffEnd: Number(start + cliff) });
      if (!keepStatus) setStatus({ kind: "", msg: "" });
    } catch (e) {
      setStatus({ kind: "err", msg: errMsg(e) });
    }
  }

  async function send(fn) {
    try {
      setStatus({ kind: "info", msg: "Konfirmasi di wallet…" });
      const s = await wallet.signer();
      const tx = await fn(s);
      await tx.wait();
      setStatus({ kind: "ok", msg: "Berhasil." });
      await load(true);
    } catch (e) {
      setStatus({ kind: "err", msg: errMsg(e) });
    }
  }

  const isCreator = info && info.l.creator.toLowerCase() === info.me.toLowerCase();

  return (
    <section className="narrow">
      <div className="eyebrow">Claim fees</div>
      <h1>Klaim fee & vesting</h1>
      <p className="lead">Masukkan alamat token yang kamu launch di sini.</p>
      <NotConfigured />
      <div className="card form">
        <label>Alamat token<input value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="0x…" /></label>
        <button className="btn primary wide" disabled={!isConfigured || !isAddress(token)} onClick={() => load()}>Cek</button>
        {info && (
          <>
            <div className="summary">
              <div><span>Token</span><b>${info.symbol}</b></div>
              <div><span>Creator</span><Addr kind="address" v={info.l.creator} /></div>
              <div><span>Fee {config.nativeSymbol} untuk kamu</span><b>{formatEther(info.ethPending)}</b></div>
              <div><span>Fee ${info.symbol} untuk kamu</span><b>{fmt(formatUnits(info.tokPending, 18))}</b></div>
            </div>
            <div className="row">
              <button className="btn ghost" disabled={info.ethPending === 0n}
                onClick={() => send((s) => new Contract(info.l.feeSplitter, splitterAbi, s).claim(ZeroAddress, info.me))}>
                Klaim {config.nativeSymbol}
              </button>
              <button className="btn ghost" disabled={info.tokPending === 0n}
                onClick={() => send((s) => new Contract(info.l.feeSplitter, splitterAbi, s).claim(info.l.token, info.me))}>
                Klaim ${info.symbol}
              </button>
            </div>
            <h4>Vesting creator</h4>
            <div className="summary">
              <div><span>Total</span><b>{fmt(formatUnits(info.total, 18))}</b></div>
              <div><span>Sudah dirilis</span><b>{fmt(formatUnits(info.released, 18))}</b></div>
              <div><span>Bisa dirilis</span><b>{fmt(formatUnits(info.releasable, 18))}</b></div>
              <div><span>Cliff selesai</span><b>{new Date(info.cliffEnd * 1000).toLocaleDateString()}</b></div>
            </div>
            <button className="btn ghost wide" disabled={info.releasable === 0n}
              onClick={() => send((s) => new Contract(info.l.vesting, vestingAbi, s).release())}>
              Rilis vesting{isCreator ? "" : " (dikirim ke creator)"}
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
      <h1>Satu transaksi, enam langkah</h1>
      <ol className="flow">
        <li><b>Mint.</b> Token ERC20 {fmt(scheme.supply)} supply dibuat. Tanpa owner, tanpa mint lagi, tanpa pajak.</li>
        <li><b>Vesting.</b> {scheme.vestPct}% masuk kontrak vesting: 0 sebelum {scheme.cliffDays} hari, lalu rilis linear sampai {scheme.vestDays} hari.</li>
        <li><b>Fee splitter.</b> Kontrak pembagi fee dibuat untuk token kamu: {scheme.creatorFeePct}% creator / {scheme.platformFeePct}% platform, terkunci.</li>
        <li><b>Pool.</b> {scheme.poolPct}% supply jadi likuiditas di pool. LP dikunci, tidak bisa ditarik.</li>
        <li><b>Dev buy (opsional).</b> {config.nativeSymbol} yang kamu kirim dipakai beli token di pool, langsung ke creator.</li>
        <li><b>Fee.</b> Setiap swap menghasilkan fee yang mengalir ke fee splitter. Klaim kapan saja.</li>
      </ol>
      <div className="card">
        <h4>Yang perlu dicek sebelum beli token apa pun</h4>
        <p className="muted">
          Token, vesting, dan fee splitter tercatat di event <code>Launched</code> dan bisa diverifikasi di explorer.
          Pemegang {scheme.vestPct}% seharusnya kontrak vesting, bukan wallet biasa.
        </p>
      </div>
    </section>
  );
}

export default function App() {
  const [page, setPage] = useState("Launch");
  const wallet = useWallet();
  const [connErr, setConnErr] = useState("");
  const wrongChain = isConfigured && wallet.account && wallet.chainId !== config.chainId;

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
      <footer className="muted small">Kontrak: Launchpad · LaunchToken · CreatorVesting · FeeSplitter. Belum diaudit.</footer>
    </div>
  );
}
