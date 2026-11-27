// Deploys an Oxva vault from your own key (contracts/.env). You become its owner.
//   npm run deploy:testnet
//   npm run deploy:mainnet                       (real ETH: asks you to type yes)
//   npm run deploy:testnet -- --fund 0.01 --budget 0.02 --cap 0.01 --approval 0.005 --agent 0x... --targets 0x...,0x...
// Defaults: you are also the agent, the only allowed target is your own address, nothing is funded.
// The deployed code is checked against the build the website ships, so the vault page shows "Verified Oxva code".
const { ContractFactory } = require("ethers");
const C = require("./lib/common");

(async () => {
  const a = C.args();
  const n = C.net(a.net);
  const art = C.artifact(), site = C.siteArtifact();
  if (art.deployedBytecode.toLowerCase() !== String(site.deployedBytecode).toLowerCase()) {
    const msg = 'The contract build differs from the one the website ships (src/assets/vault-artifact.js). Run "npm run export" and rebuild the site first, or the vault page will not verify this vault.';
    if (!n.local) throw new Error(msg); else console.warn("Warning: " + msg);
  }
  const { rpc, wallet } = await C.signer(n);
  const me = await wallet.getAddress();
  const agent = a.agent ? C.addrArg(a.agent, "--agent") : me;
  const targets = a.targets ? String(a.targets).split(",").map((t) => C.addrArg(t.trim(), t)) : [me];
  const budget = C.ethArg(a.budget ?? "0.01", "--budget"), cap = C.ethArg(a.cap ?? "0.005", "--cap"), approval = C.ethArg(a.approval ?? "0.002", "--approval");
  const fund = C.ethArg(a.fund ?? "0", "--fund");
  const balance = await rpc.getBalance(me);

  await C.confirm(n, [
    `Network:        ${n.name} (chain ${n.id})`,
    `Owner (you):    ${me}   balance ${C.eth(balance)}`,
    `Agent:          ${agent}${agent === me ? " (you)" : ""}`,
    `Hourly budget:  ${C.eth(budget)}   cap per call ${C.eth(cap)}   approve above ${C.eth(approval)}`,
    `Allowed:        ${targets.join(", ")}`,
    `Fund with:      ${C.eth(fund)}`,
    `Contract:       ${site.contractName} ${site.version} (unaudited)`
  ].join("\n"), a);

  const factory = new ContractFactory(art.abi, art.bytecode, wallet);
  const c = await factory.deploy(agent, budget, cap, approval, targets, { value: fund });
  const tx = c.deploymentTransaction();
  console.log(`Sent: ${C.txLink(n, tx.hash)}`);
  const rc = await tx.wait();
  const address = await c.getAddress();
  const verified = C.codeMatches(await rpc.getCode(address), me, site.deployedBytecode);
  C.saveDeployment(n, { address, owner: me, agent, block: rc.blockNumber, tx: tx.hash, version: site.version, deployedAt: new Date().toISOString() });

  console.log(`\nVault created: ${address}`);
  console.log(`Code check:    ${verified ? "matches the website build (Verified Oxva code)" : "DOES NOT match the website build"}`);
  if (n.explorer) console.log(`Explorer:      ${C.addrLink(n, address)}`);
  if (n.site) console.log(`On the site:   ${n.site}${address}`);
  console.log(`Saved to contracts/deployments/${n.key}.json. Manage it with: npm run vault -- status${n.key === "testnet" ? "" : " --net " + n.key}`);
  rpc.destroy();
})().catch((e) => { console.error("Failed: " + C.reason(e)); process.exit(1); });
