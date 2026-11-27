// Shared helpers for the owner's command-line scripts (key, deploy, vault).
// The private key lives only in contracts/.env (git-ignored, never published by Netlify) and is never printed.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { JsonRpcProvider, Network, Wallet, Interface, formatEther, parseEther, isAddress, getAddress } = require("ethers");

const ROOT = path.join(__dirname, "..", "..");            // contracts/
const ENV_FILE = path.join(ROOT, ".env");
const DEPLOY_DIR = path.join(ROOT, "deployments");
const KEY_NAME = "DEPLOYER_PRIVATE_KEY";

const NETS = {
  testnet: { key: "testnet", id: 46630, name: "Robinhood Chain Testnet", rpc: "https://rpc.testnet.chain.robinhood.com", explorer: "https://explorer.testnet.chain.robinhood.com", site: "https://oxvaagent.com/vault/?v=" },
  mainnet: { key: "mainnet", id: 4663, name: "Robinhood Chain (mainnet, real ETH)", rpc: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com", site: "https://oxvaagent.com/vault/?net=mainnet&v=", main: true },
  local: { key: "local", id: 31337, name: "Local Hardhat chain", rpc: "http://127.0.0.1:8545", explorer: null, site: null, local: true }
};

function loadEnv() { try { process.loadEnvFile(ENV_FILE); } catch (e) { /* no .env yet */ } }

/** --name value and --flag arguments, plus the plain words in order. */
function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2), next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[k] = true; else { out[k] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function net(name) {
  const n = NETS[String(name || "testnet").toLowerCase()];
  if (!n) throw new Error(`Unknown network "${name}". Use testnet, mainnet or local.`);
  return n;
}

function provider(n) { return new JsonRpcProvider(n.rpc, Network.from(n.id), { staticNetwork: true }); }

/** The owner's wallet on network n. On the local chain, Hardhat's own unlocked account is used, so no key is needed. */
async function signer(n) {
  const rpc = provider(n);
  if (n.local) return { rpc, wallet: await rpc.getSigner(0) };
  loadEnv();
  const key = String(process.env[KEY_NAME] || "").trim();
  if (!key) throw new Error(`No private key yet. Run "npm run key:set" (use a wallet you already have) or "npm run key:new" (make a new one).`);
  let wallet;
  try { wallet = new Wallet(key.startsWith("0x") ? key : "0x" + key, rpc); } catch (e) { throw new Error(`${KEY_NAME} in contracts/.env is not a valid private key. Run "npm run key:set" again.`); }
  return { rpc, wallet };
}

/** Writes or replaces DEPLOYER_PRIVATE_KEY in contracts/.env, keeping any other lines. */
function saveKey(privateKey) {
  let text = "";
  try { text = fs.readFileSync(ENV_FILE, "utf8"); } catch (e) { /* new file */ }
  const line = `${KEY_NAME}=${privateKey}`;
  const re = new RegExp(`^\\s*${KEY_NAME}\\s*=.*$`, "m");
  text = re.test(text) ? text.replace(re, line) : (text && !text.endsWith("\n") ? text + "\n" : text) + line + "\n";
  fs.writeFileSync(ENV_FILE, text, { mode: 0o600 });
}
function hasKey() { loadEnv(); return !!String(process.env[KEY_NAME] || "").trim(); }

function needTerminal(what) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`${what} must be run by you, in your own terminal (PowerShell or the Terminal panel), not by a tool or a pipe.`);
    process.exit(1);
  }
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

/** Asks without echoing what is typed (for the private key). */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let shown = false;
    rl._writeToOutput = function (s) { if (!shown) { rl.output.write(s); shown = true; } else if (s === "\r\n" || s === "\n" || s === "\r") rl.output.write(s); };
    rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); resolve(a.trim()); });
  });
}

/** On mainnet, every transaction needs a yes (or --yes). */
async function confirm(n, summary, opts) {
  console.log(summary);
  if (!n.main || (opts && opts.yes)) return;
  if (!process.stdin.isTTY) throw new Error("On mainnet, confirm in your own terminal, or pass --yes.");
  const a = await ask("This uses real ETH on Robinhood Chain mainnet. Continue? Type yes: ");
  if (a.toLowerCase() !== "yes") { console.log("Cancelled. Nothing was sent."); process.exit(0); }
}

function artifact() {
  const file = path.join(ROOT, "artifacts", "contracts", "OxvaVault.sol", "OxvaVault.json");
  if (!fs.existsSync(file)) throw new Error('No build yet. Run "npm run compile" first.');
  return require(file);
}
/** The build the website ships (src/assets/vault-artifact.js), so the site can verify what we deploy. */
function siteArtifact() {
  const file = path.join(ROOT, "..", "src", "assets", "vault-artifact.js");
  const window = {}; new Function("window", fs.readFileSync(file, "utf8"))(window);
  return window.OxvaVaultArtifact;
}
/** Same check as codeMatches() in src/assets/vault.js: on-chain code equals the build once the owner is masked. */
function codeMatches(code, owner, deployedBytecode) {
  return String(code).toLowerCase().split("000000000000000000000000" + owner.toLowerCase().slice(2)).join("0".repeat(64)) === String(deployedBytecode).toLowerCase();
}

function deployments(n) { try { return JSON.parse(fs.readFileSync(path.join(DEPLOY_DIR, n.key + ".json"), "utf8")); } catch (e) { return []; } }
function saveDeployment(n, entry) {
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  const list = deployments(n); list.push(entry);
  fs.writeFileSync(path.join(DEPLOY_DIR, n.key + ".json"), JSON.stringify(list, null, 2) + "\n");
}

function eth(wei) { return formatEther(wei) + " ETH"; }
function ethArg(v, what) {
  if (v === undefined || v === true || !/^\d*\.?\d+$/.test(String(v))) throw new Error(`${what} must be an amount in ETH, like 0.01.`);
  return parseEther(String(v));
}
function addrArg(v, what) { if (!isAddress(String(v || ""))) throw new Error(`${what} is not a valid address.`); return getAddress(String(v)); }

const VAULT_IFACE = () => new Interface(artifact().abi);
/** A readable reason for a failed call: the vault's own error name when there is one. */
function reason(e) {
  const data = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
  if (e && e.revert && e.revert.name) return e.revert.name;
  if (typeof data === "string" && data.length >= 10) { try { const p = VAULT_IFACE().parseError(data); if (p) return p.name; } catch (x) { /* not ours */ } }
  if (e && e.code === "INSUFFICIENT_FUNDS") return "Not enough ETH in the key's wallet for this and its gas.";
  return (e && (e.shortMessage || e.message)) || String(e);
}

function txLink(n, hash) { return n.explorer ? `${n.explorer}/tx/${hash}` : hash; }
function addrLink(n, a) { return n.explorer ? `${n.explorer}/address/${a}` : a; }

module.exports = { NETS, ENV_FILE, KEY_NAME, loadEnv, args, net, provider, signer, saveKey, hasKey, needTerminal, ask, askHidden, confirm, artifact, siteArtifact, codeMatches, deployments, saveDeployment, eth, ethArg, addrArg, reason, txLink, addrLink };
