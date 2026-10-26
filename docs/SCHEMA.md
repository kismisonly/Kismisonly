# Skema Launchpad (model Bankr / Doppler)

Ringkasan cara kerja launchpad di `contracts/`. Angka default meniru skema standar Bankr di
Robinhood Chain. Semua angka bisa diubah lewat `Launchpad.setConfig`, tapi token yang sudah
launch tetap memakai angka saat dia launch.

## 1. Alur satu transaksi `launch()`

```
User/creator ──launch(params) + ETH (opsional dev buy)──▶ Launchpad
                                                            │
  1. new LaunchToken ── mint 100B ke Launchpad ─────────────┤
  2. new CreatorVesting ◀── 15% supply ─────────────────────┤
  3. new FeeSplitter (creator X% / platform Y%) ────────────┤
  4. launcher.seed(token, 85%, feeSplitter) ──▶ Pool (Doppler / Uniswap v4), LP terkunci
  5. launcher.buy{ETH}(token → creator)   (kalau ada dev buy)
  6. emit Launched(token, pool, vesting, feeSplitter, ...)
```

Setelah transaksi selesai, Launchpad tidak memegang token sama sekali. Ini dicek dengan
`require(balance == 0)`.

## 2. Pembagian supply

| Bagian | Default | Ke mana | Bisa dijual langsung? |
|---|---|---|---|
| Pool | 85% | Adapter likuiditas (Doppler), LP dikunci | – (ini likuiditas) |
| Vesting creator | 15% (`vestBps = 1500`, maks 20%) | `CreatorVesting` | Tidak. Cliff 30 hari, lalu linear sampai 365 hari |
| Dev buy | opsional | Wallet creator | Ya. Dibeli pakai ETH di pool, bukan jatah gratis |

## 3. Fee swap

Fee diambil dari **setiap swap di pool**, bukan dari supply, dan tidak ada pajak transfer di
token. Pembagiannya dua lapis:

```
Swap ──fee pool──▶ Adapter/hook Doppler
                     ├─ bagian LP / protokol Doppler  (diatur di adapter)
                     └─ bagian "beneficiary" ──▶ FeeSplitter token ini
                                                  ├─ creator   : 10000 - platformFeeBps
                                                  └─ platform  : platformFeeBps (maks 50%)
```

Contoh: kalau beneficiary dapat 0,7% dari volume dan `platformFeeBps = 500` (5%), creator
dapat 0,665% dan platform 0,035%. Ini sama dengan angka Bankr "95% dari 0,7%".

`FeeSplitter` memakai model **pull**. Siapa saja boleh memanggil
`claim(asset, recipient)`, tapi dana selalu dikirim ke `recipient`. `asset = address(0)`
berarti ETH. Selain itu, isi dengan alamat ERC20, misalnya fee yang berbentuk token itu
sendiri.

## 4. Kontrak

| File | Peran |
|---|---|
| `contracts/LaunchToken.sol` | ERC20 polos, supply tetap, tanpa owner, tanpa mint, tanpa pajak |
| `contracts/CreatorVesting.sol` | Vesting cliff + linear. Beneficiary tidak bisa diganti |
| `contracts/FeeSplitter.sol` | Membagi ETH/ERC20 ke penerima sesuai BPS yang dikunci saat launch |
| `contracts/Launchpad.sol` | Factory + registry (`launches`, `allTokens`) + config global (owner) |
| `contracts/interfaces/ILiquidityLauncher.sol` | Adapter ke Doppler: `seed()` dan `buy()` |

## 5. Parameter

`Config` (global, oleh owner):
`totalSupply`, `vestBps`, `vestCliff`, `vestDuration`, `platformFeeBps`, `platformTreasury`.

`LaunchParams` (per launch):
`name`, `symbol`, `uri`, `creator`, `salt` (CREATE2, alamat token bisa diprediksi/vanity),
`poolData` (diteruskan ke adapter: quote token, kurva harga, tick), `seedValue`,
`devBuyMinOut` (proteksi slippage dev buy).

## 6. Yang belum ada / langkah berikutnya

- **Adapter Doppler sungguhan.** `ILiquidityLauncher` baru berupa interface, dan tesnya
  memakai `test/MockLauncher.sol`. Adapter asli harus memanggil kontrak Doppler (Airlock)
  di Robinhood Chain, menetapkan `FeeSplitter` sebagai beneficiary fee, dan mengunci LP.
  ABI dan alamatnya perlu diambil dari docs/deployment resmi Doppler. Dari environment ini
  belum bisa diakses.
- Pilihan fee hanya dalam quote token (seperti opsi Bankr) diatur di adapter.
- Audit sebelum mainnet.

## 7. Menjalankan

```
npm install
npm run compile   # solc-js, output ke build/
npm test          # ganache lokal: alokasi supply, vesting, dev buy, fee split, config
```
