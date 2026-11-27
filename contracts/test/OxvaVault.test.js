// Tests for OxvaVault. Run: cd contracts && npm test
const assert = require("node:assert/strict");
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const HOUR = 3600;

async function deploy(opts = {}) {
  const [owner, agent, stranger] = await ethers.getSigners();
  const Target = await ethers.getContractFactory("MockTarget");
  const target = await Target.deploy();
  const other = await Target.deploy();
  const Vault = await ethers.getContractFactory("OxvaVault");
  const vault = await Vault.connect(owner).deploy(
    agent.address,
    opts.budget ?? E(0.5),   // hourly budget
    opts.cap ?? E(0.25),     // per-call cap
    opts.approval ?? E(0.1), // approval above
    [await target.getAddress()],
    { value: opts.fund ?? E(2) }
  );
  return { owner, agent, stranger, vault, target, other };
}
const ping = (t) => t.interface.encodeFunctionData("ping");
async function expectRevert(promise, errorName) {
  await assert.rejects(promise, (e) => {
    const msg = String(e.message || e);
    if (!msg.includes(errorName)) throw new Error(`expected ${errorName}, got: ${msg.slice(0, 200)}`);
    return true;
  });
}
async function increase(seconds) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

describe("OxvaVault", () => {
  it("stores the owner, agent, policy and allowlist, and holds the deposit", async () => {
    const { owner, agent, vault, target } = await deploy();
    assert.equal(await vault.owner(), owner.address);
    assert.equal(await vault.agent(), agent.address);
    assert.equal(await vault.hourlyBudget(), E(0.5));
    assert.equal(await vault.allowed(await target.getAddress()), true);
    assert.equal(await ethers.provider.getBalance(await vault.getAddress()), E(2));
  });

  it("a small call from the agent to an allowed target goes through at once", async () => {
    const { agent, vault, target } = await deploy();
    await vault.connect(agent).propose(await target.getAddress(), E(0.05), ping(target));
    assert.equal(await target.pings(), 1n);
    assert.equal(await target.received(), E(0.05));
    const p = await vault.getProposal(0);
    assert.equal(p.status, 2n); // Executed
    assert.equal(await vault.spentInWindow(), E(0.05));
  });

  it("only the agent can propose; only the owner can manage", async () => {
    const { owner, stranger, vault, target } = await deploy();
    await expectRevert(vault.connect(stranger).propose(await target.getAddress(), 0, "0x"), "NotAgent");
    await expectRevert(vault.connect(owner).propose(await target.getAddress(), 0, "0x"), "NotAgent");
    await expectRevert(vault.connect(stranger).setPaused(true), "NotOwner");
    await expectRevert(vault.connect(stranger).withdraw(stranger.address, 1), "NotOwner");
    await expectRevert(vault.connect(stranger).setTarget(stranger.address, true), "NotOwner");
  });

  it("a target that is not on the allowlist is refused and nothing is stored", async () => {
    const { agent, vault, other } = await deploy();
    await expectRevert(vault.connect(agent).propose(await other.getAddress(), E(0.01), ping(other)), "TargetNotAllowed");
    assert.equal(await vault.proposalCount(), 0n);
  });

  it("a call over the per-call cap is refused, even for the owner", async () => {
    const { agent, vault, target } = await deploy();
    await expectRevert(vault.connect(agent).propose(await target.getAddress(), E(0.3), ping(target)), "OverCap");
  });

  it("above the approval threshold the call is held until the owner approves", async () => {
    const { owner, agent, vault, target } = await deploy();
    await vault.connect(agent).propose(await target.getAddress(), E(0.2), ping(target));
    assert.equal(await target.pings(), 0n, "nothing sent yet");
    assert.equal((await vault.getProposal(0)).status, 1n); // Pending
    await vault.connect(owner).approve(0);
    assert.equal(await target.pings(), 1n);
    assert.equal((await vault.getProposal(0)).status, 2n);
  });

  it("a held proposal cannot be approved twice (no replay)", async () => {
    const { owner, agent, vault, target } = await deploy();
    await vault.connect(agent).propose(await target.getAddress(), E(0.2), ping(target));
    await vault.connect(owner).approve(0);
    await expectRevert(vault.connect(owner).approve(0), "NotPending");
    assert.equal(await target.pings(), 1n);
  });

  it("the owner can reject a held proposal, and it can never run after", async () => {
    const { owner, agent, vault, target } = await deploy();
    await vault.connect(agent).propose(await target.getAddress(), E(0.2), ping(target));
    await vault.connect(owner).reject(0);
    await expectRevert(vault.connect(owner).approve(0), "NotPending");
    assert.equal(await target.pings(), 0n);
  });

  it("spending past the hourly budget is held; the window resets after an hour", async () => {
    const { agent, vault, target } = await deploy();
    const to = await target.getAddress();
    for (let i = 0; i < 5; i++) await vault.connect(agent).propose(to, E(0.095), ping(target));
    assert.equal(await vault.spentInWindow(), E(0.475));
    await vault.connect(agent).propose(to, E(0.05), ping(target)); // 0.525 > 0.5
    assert.equal((await vault.getProposal(5)).status, 1n, "held for budget");
    await increase(HOUR + 1);
    assert.equal(await vault.remainingBudget(), E(0.5));
    await vault.connect(agent).propose(to, E(0.05), ping(target));
    assert.equal((await vault.getProposal(6)).status, 2n, "new window, goes through");
  });

  it("the agent can never move tokens: transfer, approve (any amount), transferFrom, permit and NFT transfers are refused", async () => {
    const { owner, agent, vault } = await deploy();
    const Token = await ethers.getContractFactory("MockToken");
    const token = await Token.deploy(false);
    const t = await token.getAddress();
    await vault.connect(owner).setTarget(t, true); // even when the owner allowlists the token
    await token.mint(await vault.getAddress(), 1000n);
    const erc20 = new ethers.Interface([
      "function transfer(address,uint256)", "function approve(address,uint256)", "function transferFrom(address,address,uint256)",
      "function increaseAllowance(address,uint256)", "function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
      "function setApprovalForAll(address,bool)", "function safeTransferFrom(address,address,uint256)",
      "function safeTransferFrom(address,address,uint256,bytes)", "function safeTransferFrom(address,address,uint256,uint256,bytes)",
      "function safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)"
    ]);
    const a = agent.address, z = ethers.ZeroHash;
    const calls = [
      erc20.encodeFunctionData("transfer", [a, 1n]),
      erc20.encodeFunctionData("approve", [a, 1n]),
      erc20.encodeFunctionData("approve", [a, ethers.MaxUint256]),
      erc20.encodeFunctionData("transferFrom", [a, a, 1n]),
      erc20.encodeFunctionData("increaseAllowance", [a, 1n]),
      erc20.encodeFunctionData("permit", [a, a, 1n, 0n, 27, z, z]),
      erc20.encodeFunctionData("setApprovalForAll", [a, true]),
      erc20.encodeFunctionData("safeTransferFrom(address,address,uint256)", [a, a, 1n]),
      erc20.encodeFunctionData("safeTransferFrom(address,address,uint256,bytes)", [a, a, 1n, "0x"]),
      erc20.encodeFunctionData("safeTransferFrom(address,address,uint256,uint256,bytes)", [a, a, 1n, 1n, "0x"]),
      erc20.encodeFunctionData("safeBatchTransferFrom", [a, a, [1n], [1n], "0x"])
    ];
    for (const data of calls) await expectRevert(vault.connect(agent).propose(t, 0, data), "TokenCallBlocked");
    assert.equal(await token.balanceOf(await vault.getAddress()), 1000n, "tokens untouched");
  });

  it("the owner can withdraw tokens, including tokens whose transfer returns nothing", async () => {
    const { owner, stranger, vault } = await deploy();
    const Token = await ethers.getContractFactory("MockToken");
    for (const quiet of [false, true]) {
      const token = await Token.deploy(quiet);
      await token.mint(await vault.getAddress(), 500n);
      await vault.connect(owner).withdrawToken(await token.getAddress(), owner.address, 200n);
      assert.equal(await token.balanceOf(owner.address), 200n);
      await expectRevert(vault.connect(stranger).withdrawToken(await token.getAddress(), stranger.address, 1n), "NotOwner");
      await expectRevert(vault.connect(owner).withdrawToken(await token.getAddress(), owner.address, 10000n), "TransferFailed");
    }
    await expectRevert(vault.connect(owner).withdrawToken(stranger.address, owner.address, 1n), "TransferFailed"); // not a contract
  });

  it("states its version", async () => {
    const { vault } = await deploy();
    assert.match(await vault.VERSION(), /beta \(unaudited\)/);
  });

  it("the deployed code matches the build once the owner is masked (the page uses this to verify a vault)", async () => {
    const { owner, vault, target } = await deploy();
    const art = require("../artifacts/contracts/OxvaVault.sol/OxvaVault.json");
    // same rule as codeMatches() in src/assets/vault.js
    const matches = (code, own) => code.toLowerCase().split("000000000000000000000000" + own.toLowerCase().slice(2)).join("0".repeat(64)) === art.deployedBytecode.toLowerCase();
    assert.equal(matches(await ethers.provider.getCode(await vault.getAddress()), owner.address), true);
    assert.equal(matches(await ethers.provider.getCode(await target.getAddress()), owner.address), false, "other code is not a vault");
  });

  it("pausing stops the agent and blocks approvals; the owner can still withdraw", async () => {
    const { owner, agent, vault, target } = await deploy();
    const to = await target.getAddress();
    await vault.connect(agent).propose(to, E(0.2), ping(target)); // held
    await vault.connect(owner).setPaused(true);
    await expectRevert(vault.connect(agent).propose(to, E(0.01), ping(target)), "IsPaused");
    await expectRevert(vault.connect(owner).approve(0), "IsPaused");
    const before = await ethers.provider.getBalance(owner.address);
    const tx = await vault.connect(owner).withdraw(owner.address, E(1));
    const rc = await tx.wait();
    const gas = rc.gasUsed * rc.gasPrice;
    assert.equal(await ethers.provider.getBalance(owner.address), before + E(1) - gas);
  });

  it("removing a target after a proposal was held makes the approval fail (policy re-checked)", async () => {
    const { owner, agent, vault, target } = await deploy();
    const to = await target.getAddress();
    await vault.connect(agent).propose(to, E(0.2), ping(target));
    await vault.connect(owner).setTarget(to, false);
    await expectRevert(vault.connect(owner).approve(0), "TargetNotAllowed");
  });

  it("a failing call reverts the whole proposal", async () => {
    const { agent, vault, target } = await deploy();
    const bad = target.interface.encodeFunctionData("fail");
    await expectRevert(vault.connect(agent).propose(await target.getAddress(), 0, bad), "CallFailed");
    assert.equal(await vault.proposalCount(), 0n);
  });

  it("the owner can change the policy and the agent", async () => {
    const { owner, stranger, vault } = await deploy();
    await vault.connect(owner).setPolicy(E(1), E(0.5), E(0.2));
    assert.equal(await vault.perTxCap(), E(0.5));
    await vault.connect(owner).setAgent(stranger.address);
    assert.equal(await vault.agent(), stranger.address);
  });

  it("deposits from anyone are accepted and logged", async () => {
    const { stranger, vault } = await deploy();
    await stranger.sendTransaction({ to: await vault.getAddress(), value: E(0.3) });
    assert.equal(await ethers.provider.getBalance(await vault.getAddress()), E(2.3));
  });
});
