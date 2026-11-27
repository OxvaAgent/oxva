// Exercises the same ethers calls src/assets/vault.js makes, against a local `npx hardhat node`.
// Uses Hardhat's built-in public test accounts on a local chain only. Run: node scripts/smoke-ui.js
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const E = require("ethers");

const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "assets", "vault-artifact.js"), "utf8");
const window = {}; new Function("window", src)(window);
const A = window.OxvaVaultArtifact;
const iface = new E.Interface(A.abi);

(async () => {
  const rpc = new E.JsonRpcProvider("http://127.0.0.1:8545");
  const owner = await rpc.getSigner(0), agent = await rpc.getSigner(1);
  const ownerA = await owner.getAddress(), agentA = await agent.getAddress(), payee = E.Wallet.createRandom().address;

  // create, as the page does
  const factory = new E.ContractFactory(A.abi, A.bytecode, owner);
  const c = await factory.deploy(agentA, E.parseEther("0.01"), E.parseEther("0.005"), E.parseEther("0.002"), [payee], { value: E.parseEther("0.005") });
  const tx = c.deploymentTransaction(); const rc = await tx.wait(); const addr = await c.getAddress();
  console.log("deployed", addr, "block", rc.blockNumber);
  for (let i = 0; i < 5; i++) await rpc.send("evm_mine", []);

  // read state, as openVault does
  const v = new E.Contract(addr, A.abi, rpc);
  const r = await Promise.all([v.owner(), v.agent(), v.paused(), v.hourlyBudget(), v.perTxCap(), v.approvalAbove(), v.remainingBudget(), v.proposalCount(), rpc.getBalance(addr)]);
  assert.equal(r[0], ownerA); assert.equal(r[1], agentA); assert.equal(r[8], E.parseEther("0.005"));

  // simulate as the agent without its key (staticCall with from)
  await v.propose.staticCall(payee, E.parseEther("0.001"), "0x", { from: agentA });
  let refused = null;
  try { await v.propose.staticCall(ownerA, E.parseEther("0.001"), "0x", { from: agentA }); } catch (e) { refused = e; }
  const name = refused && (refused.revert ? refused.revert.name : iface.parseError(refused.data).name);
  assert.equal(name, "TargetNotAllowed");
  console.log("simulation: allowed ok, unknown target ->", name);

  // agent proposes (sent) and proposes above threshold (held); owner approves
  await (await new E.Contract(addr, A.abi, agent).propose(payee, E.parseEther("0.001"), "0x")).wait();
  const heldRc = await (await new E.Contract(addr, A.abi, agent).propose(payee, E.parseEther("0.003"), "0x")).wait();
  const held = heldRc.logs.some((l) => { try { return iface.parseLog(l).name === "Held"; } catch (e) { return false; } });
  assert.ok(held, "second proposal held");
  await (await new E.Contract(addr, A.abi, owner).approve(1)).wait();
  assert.equal(await rpc.getBalance(payee), E.parseEther("0.004"));
  console.log("propose sent, propose held, owner approved: payee has", E.formatEther(await rpc.getBalance(payee)), "ETH");

  // deposit by plain transfer, as the page does
  await (await owner.sendTransaction({ to: addr, value: E.parseEther("0.002") })).wait();

  // find the deploy block by binary search on code, as deployBlock does
  const head = await rpc.getBlockNumber();
  let lo = 0, hi = head;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if ((await rpc.getCode(addr, mid)) !== "0x") hi = mid; else lo = mid + 1; }
  assert.equal(lo, rc.blockNumber);
  console.log("deploy block found by search:", lo);

  // read and parse the log, as renderLog does
  const logs = await rpc.getLogs({ address: addr, fromBlock: lo, toBlock: head });
  const names = logs.map((l) => iface.parseLog(l).name);
  console.log("events:", names.join(", "));
  for (const n of ["TargetSet", "AgentSet", "PolicySet", "Deposited", "Proposed", "Executed", "Held"]) assert.ok(names.includes(n), n + " logged");

  // proposals view
  const p1 = await v.getProposal(1);
  assert.equal(Number(p1.status), 2);

  // the page's "Verified Oxva code" check, taken from vault.js itself
  const vjs = fs.readFileSync(path.join(__dirname, "..", "..", "src", "assets", "vault.js"), "utf8");
  const fnSrc = vjs.match(/function codeMatches\(code, owner\) \{[\s\S]*?\n  \}/)[0];
  const codeMatches = new Function("A", fnSrc + "; return codeMatches;")(A);
  assert.equal(codeMatches(await rpc.getCode(addr), ownerA), true, "a vault from this build verifies");
  assert.equal(codeMatches(await rpc.getCode(addr), agentA), false, "wrong owner does not verify");
  console.log("code check: this build verifies, a wrong owner does not");

  // the agent can never move tokens; the owner can withdraw them (as the page's Withdraw token does)
  const tokArt = require(path.join(__dirname, "..", "artifacts", "contracts", "test", "MockToken.sol", "MockToken.json"));
  const tok = await new E.ContractFactory(tokArt.abi, tokArt.bytecode, owner).deploy(false);
  const tokA = await tok.getAddress();
  await (await tok.mint(addr, 1000n)).wait();
  await (await new E.Contract(addr, A.abi, owner).setTarget(tokA, true)).wait();
  let blocked = null;
  const transferData = new E.Interface(["function transfer(address,uint256)"]).encodeFunctionData("transfer", [agentA, 1n]);
  try { await v.propose.staticCall(tokA, 0, transferData, { from: agentA }); } catch (e) { blocked = e.revert ? e.revert.name : iface.parseError(e.data).name; }
  assert.equal(blocked, "TokenCallBlocked");
  await (await new E.Contract(addr, A.abi, owner).withdrawToken(tokA, ownerA, 400n)).wait();
  assert.equal(await tok.balanceOf(ownerA), 400n);
  const names2 = (await rpc.getLogs({ address: addr, fromBlock: lo, toBlock: "latest" })).map((l) => iface.parseLog(l).name);
  assert.ok(names2.includes("TokenWithdrawn"), "TokenWithdrawn logged");
  console.log("agent token transfer ->", blocked, "; owner withdrew 400 token units");
  assert.match(await v.VERSION(), new RegExp(A.version.replace(/[.]/g, "\\.")));
  console.log("\nUI smoke test passed");
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
