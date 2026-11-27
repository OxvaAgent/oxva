// Model-based random testing for OxvaVault.
// A plain JavaScript model of the vault's rules runs side by side with the real contract. Hundreds of random
// actions (agent proposals, owner approvals and rejections, pauses, policy and allowlist changes, deposits,
// withdrawals, time jumps) are applied to both, and after every step the contract must match the model exactly:
// same revert reason, same proposal statuses, same budget window, same balances.
const assert = require("node:assert/strict");
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const SEEDS = [1, 7, 2026];
const STEPS = 300;
const HOUR = 3600;

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function errName(e) {
  if (e && e.revert && e.revert.name) return e.revert.name;
  const m = String((e && e.message) || e).match(/custom error '(\w+)/);
  return m ? m[1] : "UNKNOWN: " + String((e && e.message) || e).slice(0, 160);
}
const TOKEN_SELECTORS = new Set(["0xa9059cbb", "0x23b872dd", "0x095ea7b3", "0x39509351", "0xa22cb465", "0x42842e0e", "0xb88d4fde", "0xf242432a", "0x2eb2c2d6", "0xd505accf"]);

describe("OxvaVault: model-based random testing", function () {
  this.timeout(300000);

  for (const seed of SEEDS) {
    it(`matches the model for ${STEPS} random actions (seed ${seed})`, async () => {
      const r = rng(seed), pick = (arr) => arr[Math.floor(r() * arr.length)];
      const [owner, agent, stranger, payee] = await ethers.getSigners();
      const Target = await ethers.getContractFactory("MockTarget");
      const t1 = await Target.deploy(), t2 = await Target.deploy();
      const T1 = await t1.getAddress(), T2 = await t2.getAddress(), P = payee.address;
      const Vault = await ethers.getContractFactory("OxvaVault");
      const vault = await Vault.connect(owner).deploy(agent.address, E(0.5), E(0.25), E(0.1), [T1, P], { value: E(2) });
      const V = await vault.getAddress();
      const deployTs = (await ethers.provider.getBlock("latest")).timestamp;

      const M = { paused: false, budget: E(0.5), cap: E(0.25), approval: E(0.1), allowed: { [T1]: true, [P]: true, [T2]: false },
        windowStart: BigInt(deployTs), spent: 0n, props: [], balance: E(2), recv: { [T1]: 0n, [T2]: 0n }, payeeIn: 0n };
      let ts = deployTs;
      const payeeStart = await ethers.provider.getBalance(P);

      const ping = t1.interface.encodeFunctionData("ping"), fail = t1.interface.encodeFunctionData("fail");
      const transferData = new ethers.Interface(["function transfer(address,uint256)"]).encodeFunctionData("transfer", [P, 1n]);
      const amounts = [0n, E(0.001), E(0.05), E(0.09), E(0.1), E(0.11), E(0.2), E(0.25), E(0.26), E(0.6)];

      const clone = () => ({ ...M, allowed: { ...M.allowed }, recv: { ...M.recv }, props: M.props.map((p) => ({ ...p })) });
      const roll = (m, at) => { if (BigInt(at) >= m.windowStart + BigInt(HOUR)) { m.windowStart = BigInt(at); m.spent = 0n; } };
      const check = (m, p) => {
        if (m.paused) return "IsPaused";
        if (!m.allowed[p.to]) return "TargetNotAllowed";
        if (p.value > m.cap) return "OverCap";
        if (p.data.length >= 10 && TOKEN_SELECTORS.has(p.data.slice(0, 10))) return "TokenCallBlocked";
        return null;
      };
      const execute = (m, p) => {
        if (p.value > m.balance) return "CallFailed";             // not enough ETH in the vault
        if (p.data === fail) return "CallFailed";                 // target reverts
        m.balance -= p.value;
        if (p.to === P) m.payeeIn += p.value; else m.recv[p.to] += p.value;
        p.status = 2;
        return null;
      };

      async function send(txPromiseFn, apply) {
        // decide the block time, run the model on a copy, then the contract; commit the copy only on success
        ts += 1 + (r() < 0.15 ? Math.floor(r() * 2 * HOUR) : Math.floor(r() * 120));
        const m = clone();
        const expected = apply(m, ts);
        await network.provider.send("evm_setNextBlockTimestamp", [ts]);
        let got = null;
        try { await (await txPromiseFn()).wait(); } catch (e) { got = errName(e); }
        assert.equal(got, expected, `step mismatch: expected ${expected || "success"}, got ${got || "success"}`);
        if (!expected) Object.assign(M, m);
      }

      for (let step = 0; step < STEPS; step++) {
        const roll100 = r();
        if (roll100 < 0.45) { // agent proposes
          const p = { to: pick([T1, T1, P, T2]), value: pick(amounts), data: pick(["0x", "0x", ping, ping, fail, transferData]), status: 1 };
          if (p.to === P && p.data !== "0x" && p.data !== transferData) p.data = "0x";
          await send(() => vault.connect(agent).propose(p.to, p.value, p.data), (m, at) => {
            const bad = check(m, p); if (bad) return bad;
            roll(m, at);
            const q = { ...p }; m.props.push(q);
            if (q.value > m.approval) return null;                       // held for approval
            if (m.spent + q.value > m.budget) return null;               // held for budget
            m.spent += q.value;
            return execute(m, q);
          });
        } else if (roll100 < 0.6 && M.props.length) { // owner approves
          const id = Math.floor(r() * M.props.length);
          await send(() => vault.connect(owner).approve(id), (m, at) => {
            const q = m.props[id];
            if (q.status !== 1) return "NotPending";
            const bad = check(m, q); if (bad) return bad;
            roll(m, at); m.spent += q.value;
            return execute(m, q);
          });
        } else if (roll100 < 0.68 && M.props.length) { // owner rejects
          const id = Math.floor(r() * M.props.length);
          await send(() => vault.connect(owner).reject(id), (m) => { if (m.props[id].status !== 1) return "NotPending"; m.props[id].status = 3; return null; });
        } else if (roll100 < 0.73) { // pause / resume
          const b = r() < 0.4;
          await send(() => vault.connect(owner).setPaused(b), (m) => { m.paused = b; return null; });
        } else if (roll100 < 0.78) { // policy change
          const b = pick([E(0.2), E(0.5), E(1)]), c = pick([E(0.1), E(0.25), E(0.5)]), a = pick([E(0.05), E(0.1), E(0.3)]);
          await send(() => vault.connect(owner).setPolicy(b, c, a), (m) => { m.budget = b; m.cap = c; m.approval = a; return null; });
        } else if (roll100 < 0.84) { // allowlist change
          const who = pick([T2, T2, P]), ok = r() < 0.5;
          await send(() => vault.connect(owner).setTarget(who, ok), (m) => { m.allowed[who] = ok; return null; });
        } else if (roll100 < 0.92) { // deposit
          const v = pick([E(0.1), E(0.3)]);
          await send(() => stranger.sendTransaction({ to: V, value: v }), (m) => { m.balance += v; return null; });
        } else { // owner withdraws
          const v = pick([E(0.05), E(0.5), E(5)]);
          await send(() => vault.connect(owner).withdraw(owner.address, v), (m) => { if (v > m.balance) return "TransferFailed"; m.balance -= v; return null; });
        }

        // invariants after every step
        assert.equal(await vault.spentInWindow(), M.spent, `spentInWindow at step ${step}`);
        assert.equal(await vault.windowStart(), M.windowStart, `windowStart at step ${step}`);
        assert.equal(await vault.paused(), M.paused);
        assert.equal(await vault.proposalCount(), BigInt(M.props.length));
        assert.equal(await ethers.provider.getBalance(V), M.balance, `vault balance at step ${step}`);
        assert.equal(await t1.received(), M.recv[T1]);
        assert.equal(await t2.received(), M.recv[T2]);
      }

      for (let i = 0; i < M.props.length; i++) assert.equal(Number((await vault.getProposal(i)).status), M.props[i].status, `proposal ${i} status`);
      assert.equal((await ethers.provider.getBalance(P)) - payeeStart, M.payeeIn, "payee received exactly what the model says");
      const executed = M.props.filter((p) => p.status === 2).length, held = M.props.filter((p) => p.status === 1).length;
      console.log(`      seed ${seed}: ${M.props.length} proposals (${executed} sent, ${held} still held), vault ${ethers.formatEther(M.balance)} ETH`);
    });
  }
});
