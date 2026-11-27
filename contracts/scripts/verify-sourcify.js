// Verifies a deployed Oxva Vault on Sourcify from the published solc standard JSON input
// (src/assets/contracts/, written by "npm run export"). Explorers that read Sourcify, such as Blockscout on
// Robinhood Chain, then show the vault as verified.
//   npm run verify:sourcify                               Oxva's showcase vault on mainnet (deployments/mainnet.json)
//   npm run verify:sourcify -- <address> [creationTx]     any vault on mainnet
//   npm run verify:sourcify -- --net testnet <address> [creationTx]
// Sends only public data: the source, the compiler settings, the address and the creation transaction.
// No key and no account. Blockscout's own API sits behind a bot check, so this goes through Sourcify instead.
const fs = require("fs");
const path = require("path");

const API = "https://sourcify.dev/server";
const NETS = { mainnet: 4663, testnet: 46630 };
const root = path.join(__dirname, "..", "..");
const headers = { "content-type": "application/json", accept: "application/json", "user-agent": "oxva-verify/1.0 (+https://oxvaagent.com)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function args() {
  const a = process.argv.slice(2);
  let net = "mainnet";
  const i = a.indexOf("--net");
  if (i >= 0) { net = a[i + 1]; a.splice(i, 2); }
  if (!NETS[net]) throw new Error("--net must be mainnet or testnet");
  let [address, tx] = a;
  if (!address) {
    const list = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", net + ".json"), "utf8"));
    const pick = list.find((d) => d.showcase) || list[0];
    if (!pick) throw new Error("no vault recorded in deployments/" + net + ".json; pass an address");
    address = pick.address; tx = tx || pick.tx;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("not an address: " + address);
  if (tx && !/^0x[0-9a-fA-F]{64}$/.test(tx)) throw new Error("not a transaction hash: " + tx);
  return { chain: NETS[net], net, address, tx };
}

async function main() {
  const { chain, net, address, tx } = args();
  const pub = path.join(root, "src", "assets", "contracts");
  const settings = JSON.parse(fs.readFileSync(path.join(pub, "OxvaVault.json"), "utf8"));
  const stdJsonInput = JSON.parse(fs.readFileSync(path.join(pub, "OxvaVault.standard-input.json"), "utf8"));
  const compilerVersion = settings.compiler.replace(/^v/, "");
  console.log(`Vault ${address} on ${net} (chain ${chain})`);
  console.log(`${settings.contract} ${settings.version}, solc ${compilerVersion}, optimizer ${settings.optimizer.runs} runs, EVM ${settings.evmVersion}`);

  const before = await fetch(`${API}/v2/contract/${chain}/${address}`, { headers });
  if (before.ok) {
    const c = await before.json();
    if (c.match) { console.log(`Already verified: match=${c.match} runtime=${c.runtimeMatch} creation=${c.creationMatch}`); return links(chain, address); }
  }

  const body = { stdJsonInput, compilerVersion, contractIdentifier: "contracts/OxvaVault.sol:OxvaVault" };
  if (tx) body.creationTransactionHash = tx;
  console.log("Submitting the source to Sourcify…");
  const res = await fetch(`${API}/v2/verify/${chain}/${address}`, { method: "POST", headers, body: JSON.stringify(body) });
  const sent = await res.json().catch(() => ({}));
  if (!res.ok || !sent.verificationId) { console.log(`Sourcify refused the request (HTTP ${res.status}): ${JSON.stringify(sent).slice(0, 400)}`); process.exitCode = 1; return; }
  console.log(`Job ${sent.verificationId}: Sourcify compiles the source and compares it with the chain…`);

  for (let i = 0; i < 60; i++) {
    await sleep(4000);
    const job = await fetch(`${API}/v2/verify/${sent.verificationId}`, { headers }).then((r) => r.json()).catch(() => null);
    if (!job || !job.isJobCompleted) { process.stdout.write("."); continue; }
    console.log("");
    if (job.error) { console.log(`Not verified: ${job.error.customCode || ""} ${job.error.message || JSON.stringify(job.error)}`); process.exitCode = 1; return; }
    const c = job.contract || {};
    console.log(`Verified: match=${c.match} runtime=${c.runtimeMatch} creation=${c.creationMatch}`);
    return links(chain, address);
  }
  console.log("\nSourcify is still working on it. Run this again in a few minutes to see the result.");
}

function links(chain, address) {
  const explorer = chain === 4663 ? "https://robinhoodchain.blockscout.com" : "https://explorer.testnet.chain.robinhood.com";
  console.log(`Sourcify: https://repo.sourcify.dev/${chain}/${address}`);
  console.log(`Explorer: ${explorer}/address/${address}?tab=contract`);
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
