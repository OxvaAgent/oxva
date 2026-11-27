// Oxva Vault build and test setup.
// Your own key (for deploying and managing your vault from the terminal) lives only in contracts/.env, which is
// git-ignored. Set it with "npm run key:set" or "npm run key:new"; it is never printed. Visitors still create their own
// vaults from the website with their own wallets.
require("@nomicfoundation/hardhat-ethers");
try { process.loadEnvFile(require("path").join(__dirname, ".env")); } catch (e) { /* no .env yet */ }
const key = String(process.env.DEPLOYER_PRIVATE_KEY || "").trim();
const accounts = key ? [key.startsWith("0x") ? key : "0x" + key] : [];

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris" // widest compatibility (no PUSH0), fine for Arbitrum Orbit chains like Robinhood Chain
    }
  },
  networks: {
    robinhoodTestnet: { url: "https://rpc.testnet.chain.robinhood.com", chainId: 46630, accounts },
    robinhood: { url: "https://rpc.mainnet.chain.robinhood.com", chainId: 4663, accounts }
  }
};
