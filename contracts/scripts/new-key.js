// Makes a brand-new wallet for Oxva and saves its private key into contracts/.env. Run it yourself: npm run key:new
// Only the address is printed. Back up the key yourself: open contracts/.env in a text editor and store the
// DEPLOYER_PRIVATE_KEY line somewhere safe (a password manager). If you lose it, the wallet and its funds are gone.
const { Wallet } = require("ethers");
const { needTerminal, saveKey, hasKey, ENV_FILE } = require("./lib/common");

needTerminal("npm run key:new");
if (hasKey()) {
  console.error('A key is already saved in contracts/.env. Nothing changed. To use a different wallet, run "npm run key:set".');
  process.exit(1);
}
const wallet = Wallet.createRandom();
saveKey(wallet.privateKey);
console.log(`New wallet made and saved to ${ENV_FILE}`);
console.log(`Address: ${wallet.address}`);
console.log("Back it up now: open contracts/.env in Notepad and keep the key in a password manager. Never share it.");
console.log("Then send it a little ETH (test ETH from the faucet for testnet) and run: npm run key:check");
