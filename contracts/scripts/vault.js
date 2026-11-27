// Manage your Oxva vault from the terminal with your own key (contracts/.env).
//   npm run vault -- status                        (testnet; add --net mainnet for mainnet)
//   npm run vault -- deposit 0.01
//   npm run vault -- withdraw 0.01 [--to 0x...]
//   npm run vault -- withdraw-token 0xTOKEN 10.5 [--to 0x...]
//   npm run vault -- pause | resume
//   npm run vault -- policy <hourly budget> <cap per call> <approve above>
//   npm run vault -- allow 0x... | remove 0x...
//   npm run vault -- agent 0x...
//   npm run vault -- approve <id> | reject <id>
//   npm run vault -- propose <to> <eth> [calldata]   (only if your key is the vault's agent)
// The vault is your latest one in contracts/deployments/<net>.json, or pass --vault 0x...
// On mainnet each transaction asks you to type yes (or pass --yes).
const { Contract, parseUnits } = require("ethers");
const C = require("./lib/common");

const STATUS = ["none", "pending", "executed", "rejected"];

(async () => {
  const a = C.args();
  const n = C.net(a.net);
  const [cmd = "status", ...rest] = a._;
  const list = C.deployments(n);
  const address = a.vault ? C.addrArg(a.vault, "--vault") : list.length ? list[list.length - 1].address : null;
  if (!address) throw new Error(`No vault yet on ${n.name}. Run "npm run deploy:${n.key}" first, or pass --vault 0x...`);
  const site = C.siteArtifact();
  let rpc, wallet = null, me = null;
  try { ({ rpc, wallet } = await C.signer(n)); me = await wallet.getAddress(); }
  catch (e) { if (cmd !== "status") throw e; rpc = C.provider(n); } // status needs no key
  const v = new Contract(address, C.artifact().abi, wallet || rpc);

  if (cmd === "status") {
    const [owner, agent, paused, budget, cap, approval, left, count, bal, code] = await Promise.all([v.owner(), v.agent(), v.paused(), v.hourlyBudget(), v.perTxCap(), v.approvalAbove(), v.remainingBudget(), v.proposalCount(), rpc.getBalance(address), rpc.getCode(address)]);
    const pending = [];
    for (let i = Math.max(0, Number(count) - 50); i < Number(count); i++) { const p = await v.getProposal(i); if (Number(p.status) === 1) pending.push(`#${i} ${C.eth(p.value)} to ${p.to}`); }
    console.log([
      `Vault       ${address}  (${n.name})`,
      `Code        ${C.codeMatches(code, owner, site.deployedBytecode) ? "Verified Oxva code " + site.version : "not the current Oxva build"}`,
      `Balance     ${C.eth(bal)}`,
      `Owner       ${owner}${owner === me ? " (your key)" : ""}`,
      `Agent       ${agent}${agent === me ? " (your key)" : ""}`,
      `Paused      ${paused ? "yes" : "no"}`,
      `Rules       ${C.eth(budget)}/hour, cap ${C.eth(cap)} per call, approve above ${C.eth(approval)}`,
      `Left        ${C.eth(left)} this hour`,
      `Proposals   ${count} total${pending.length ? "; waiting for you: " + pending.join("; ") : ""}`,
      n.site ? `On the site ${n.site}${address}` : ""
    ].filter(Boolean).join("\n"));
    rpc.destroy();
    return;
  }

  const to = a.to ? C.addrArg(a.to, "--to") : me;
  let summary, send;
  switch (cmd) {
    case "deposit": { const x = C.ethArg(rest[0], "Amount"); summary = `Deposit ${C.eth(x)} into ${address}`; send = () => wallet.sendTransaction({ to: address, value: x }); break; }
    case "withdraw": { const x = C.ethArg(rest[0], "Amount"); summary = `Withdraw ${C.eth(x)} from the vault to ${to}`; send = () => v.withdraw(to, x); break; }
    case "withdraw-token": {
      const token = C.addrArg(rest[0], "Token"); const raw = String(rest[1] || "");
      if (!/^\d*\.?\d+$/.test(raw)) throw new Error("Token amount must be a number, like 10.5.");
      let dec = 18; try { dec = Number(await new Contract(token, ["function decimals() view returns (uint8)"], rpc).decimals()); } catch (e) { /* assume 18 */ }
      const x = parseUnits(raw, dec); summary = `Withdraw ${raw} of token ${token} to ${to}`; send = () => v.withdrawToken(token, to, x); break;
    }
    case "pause": summary = "Pause the vault (the agent can do nothing until you resume)"; send = () => v.setPaused(true); break;
    case "resume": summary = "Resume the vault"; send = () => v.setPaused(false); break;
    case "policy": { const b = C.ethArg(rest[0], "Hourly budget"), c = C.ethArg(rest[1], "Cap per call"), p = C.ethArg(rest[2], "Approve above"); summary = `Set rules: ${C.eth(b)}/hour, cap ${C.eth(c)}, approve above ${C.eth(p)}`; send = () => v.setPolicy(b, c, p); break; }
    case "allow": { const t = C.addrArg(rest[0], "Address"); summary = `Allow ${t}`; send = () => v.setTarget(t, true); break; }
    case "remove": { const t = C.addrArg(rest[0], "Address"); summary = `Remove ${t} from the allowlist`; send = () => v.setTarget(t, false); break; }
    case "agent": { const t = C.addrArg(rest[0], "Agent"); summary = `Set the agent to ${t}`; send = () => v.setAgent(t); break; }
    case "approve": case "reject": {
      const id = Number(rest[0]); if (!Number.isInteger(id) || id < 0) throw new Error("Give the proposal id, like 3.");
      if (id >= Number(await v.proposalCount())) throw new Error(`There is no proposal #${id}.`);
      const p = await v.getProposal(id);
      if (Number(p.status) !== 1) throw new Error(`Proposal #${id} is not waiting (it is ${STATUS[Number(p.status)]}).`);
      summary =`${cmd === "approve" ? "Approve" : "Reject"} proposal #${id}: ${C.eth(p.value)} to ${p.to} (${STATUS[Number(p.status)]})`;
      send = () => (cmd === "approve" ? v.approve(id) : v.reject(id)); break;
    }
    case "propose": {
      const t = C.addrArg(rest[0], "Target"), x = C.ethArg(rest[1], "Amount"), data = rest[2] || "0x";
      if (!/^0x([0-9a-fA-F]{2})*$/.test(data)) throw new Error("Call data must be hex, like 0x.");
      await v.propose.staticCall(t, x, data); // refuses here, before anything is signed, if a rule is broken
      summary = `Propose as the agent: ${C.eth(x)} to ${t}${data !== "0x" ? " with call " + data.slice(0, 10) : ""}`; send = () => v.propose(t, x, data); break;
    }
    default: throw new Error(`Unknown command "${cmd}". See the top of contracts/scripts/vault.js for the list.`);
  }

  await C.confirm(n, `${summary}\nVault ${address} on ${n.name}, signed by ${me}`, a);
  const tx = await send();
  console.log(`Sent: ${C.txLink(n, tx.hash)}`);
  const rc = await tx.wait();
  const events = rc.logs.map((l) => { try { return v.interface.parseLog(l); } catch (e) { return null; } }).filter(Boolean).map((e) => e.name);
  console.log(`Done in block ${rc.blockNumber}${events.length ? ": " + events.join(", ") : ""}.`);
  rpc.destroy();
})().catch((e) => { console.error("Failed: " + C.reason(e)); process.exit(1); });
