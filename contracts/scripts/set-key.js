// Saves the private key of a wallet you already have into contracts/.env, so you can deploy and manage
// Oxva vaults from your own terminal. Run it yourself: npm run key:set
// What you type is not shown on screen, and the key is never printed, logged or committed (.env is git-ignored).
const { Wallet } = require("ethers");
const { needTerminal, askHidden, ask, saveKey, hasKey, ENV_FILE } = require("./lib/common");

(async () => {
  needTerminal("npm run key:set");
  console.log("Use a separate wallet just for Oxva, holding only what you need. Never your main wallet.");
  if (hasKey()) {
    const a = await ask("A key is already saved in contracts/.env. Replace it? Type yes: ");
    if (a.toLowerCase() !== "yes") { console.log("Nothing changed."); return; }
  }
  const raw = await askHidden("Paste the private key (hidden), then press Enter: ");
  let wallet;
  try { wallet = new Wallet(raw.startsWith("0x") ? raw : "0x" + raw); } catch (e) { console.error("That is not a valid private key. Nothing was saved."); process.exit(1); }
  saveKey(wallet.privateKey);
  console.log(`Saved to ${ENV_FILE}`);
  console.log(`Wallet address: ${wallet.address}`);
  console.log('Next: "npm run key:check" to see its balance, then "npm run deploy:testnet".');
})().catch((e) => { console.error(e.message); process.exit(1); });
