// Kompilasi semua kontrak dengan solc-js (tanpa download compiler).
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const files = [
  "contracts/LaunchToken.sol",
  "contracts/CreatorVesting.sol",
  "contracts/FeeSplitter.sol",
  "contracts/Launchpad.sol",
  "contracts/interfaces/ILiquidityLauncher.sol",
  "test/MockLauncher.sol",
  "test/DopplerEncodingHarness.sol",
  "test/MockDoppler.sol",
];
const sources = Object.fromEntries(files.map((f) => [f, { content: fs.readFileSync(f, "utf8") }]));
function findImports(p) {
  for (const base of [".", "node_modules"]) {
    const full = path.join(base, p);
    if (fs.existsSync(full)) return { contents: fs.readFileSync(full, "utf8") };
  }
  return { error: "not found: " + p };
}
const input = {
  language: "Solidity",
  sources,
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (out.errors || []).filter((e) => e.severity === "error");
(out.errors || []).forEach((e) => console.error(e.formattedMessage));
if (errors.length) process.exit(1);
fs.mkdirSync("build", { recursive: true });
for (const [file, contracts] of Object.entries(out.contracts)) {
  for (const [name, c] of Object.entries(contracts)) {
    fs.writeFileSync(`build/${name}.json`, JSON.stringify({ abi: c.abi, bytecode: c.evm.bytecode.object }));
  }
}
console.log("compiled:", Object.values(out.contracts).flatMap((c) => Object.keys(c)).join(", "));
