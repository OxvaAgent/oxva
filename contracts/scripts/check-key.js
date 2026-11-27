// Shows the address of the saved key and its balance on Robinhood Chain testnet and mainnet. Never shows the key.
// npm run key:check
const { NETS, signer, eth, deployments } = require("./lib/common");

(async () => {
  for (const n of [NETS.testnet, NETS.mainnet]) {
    const { rpc, wallet } = await signer(n);
    const address = wallet.address;
    if (n === NETS.testnet) console.log(`Key address: ${address}`);
    let bal;
    try { bal = eth(await rpc.getBalance(address)); } catch (e) { bal = "network not answering"; }
    const mine = deployments(n).filter((d) => d.owner.toLowerCase() === address.toLowerCase());
    console.log(`${n.name.padEnd(36)} ${bal}${mine.length ? `   vaults: ${mine.map((d) => d.address).join(", ")}` : ""}`);
    rpc.destroy();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
