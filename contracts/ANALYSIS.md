# OxvaVault: automated analysis and review

**This is not an audit.** It is the output of two automated analysers on `contracts/contracts/OxvaVault.sol` (OxvaVault 1.1.0-beta), with every finding reviewed by hand. No outside firm or independent auditor has reviewed the contract. The mainnet vault stays an unaudited beta.

- Date: 27 November 2026
- Contract: `OxvaVault.sol`, Solidity 0.8.28, optimizer 200 runs, EVM paris (the build the website ships and verifies as "Verified Oxva code")
- Tools:
  - **Slither 0.11.6** (Trail of Bits). Runs in GitHub Actions (`.github/workflows/contract-analysis.yml`) whenever `contracts/` changes, and on demand.
  - **Solhint 6.2.5**, `solhint:recommended` rules (`contracts/.solhint.json`).
- Also in place: 21 Hardhat tests (`npm test`), including a model-based random test of 900 actions (`test/OxvaVault.fuzz.test.js`), and a real-ETH run of every vault action on mainnet (deposit, small and held proposals, approve, reject, allowlist refusal, pause, withdraw).

## Result

| Severity | Slither | Solhint |
|---|---|---|
| High | 0 | 0 errors |
| Medium | 0 | — |
| Low | 6 | — |
| Informational | 4 | 99 warnings (style, documentation and gas; none about security) |

No finding requires a change to the deployed contract. Each one is explained below.

## Slither findings, reviewed

### Low: missing zero-address check (4)
- **`withdraw(to, …)` and `withdrawToken(…, to, …)`**: the owner could send funds to `address(0)` by mistake.
  **Review:** only the owner can call these, so a mistake costs only the owner's own funds. The website always withdraws to the connected owner's address, and the terminal script defaults to the key's own address. **Accepted.** A future version could reject `address(0)` in the contract itself.
- **`constructor(agent_, …)` and `setAgent(agent_)`**: the agent can be set to `address(0)`.
  **Review:** an agent of `address(0)` can never sign a proposal, so the vault simply has no agent. That is a safe state, and is the same as switching the agent off. **Accepted, by design.**

### Low: block timestamp in comparisons (2)
- **`_roll()` and `remainingBudget()`** start a new one-hour budget window using `block.timestamp`.
  **Review:** on Robinhood Chain (Arbitrum Orbit) the sequencer sets timestamps within a narrow bound. At worst a budget window could start a few seconds early or late. Nothing else depends on time. **Accepted.**

### Informational: inline assembly (1)
- **`_selector(data)`** reads the first four bytes of the call data with one `mload`.
  **Review:** it runs only after checking `data.length >= 4` (shorter data returns `bytes4(0)`), and it only reads memory. **Accepted.**

### Informational: low-level calls (3)
- **`_execute`**: the proposed call to the target.
- **`withdraw`**: the ETH transfer to the owner.
- **`withdrawToken`**: the token `transfer`, made with a low-level call so tokens that return nothing also work.

**Review:** all three check the result and revert on failure. `withdrawToken` also rejects addresses with no code and a `false` return value. Every function that makes an external call is `nonReentrant`. `_execute` marks the proposal `Executed` before the call (checks, effects, then interactions), so a proposal can never run twice. **Accepted.**

## Points from the manual review (not flagged by the tools)
- **Owner approval and the hourly budget.** `approve(id)` re-checks pause, allowlist, cap and token-call rules, and counts the value toward the hour's budget, but does not refuse when the budget is spent. This is intended: approval is the owner's override of the budget, never of the cap or the allowlist.
- **The agent cannot move tokens.** `transfer`, `transferFrom`, `approve`, `increaseAllowance`, `setApprovalForAll`, `permit` and the ERC-721/1155 transfer selectors are refused for the agent, because token amounts are not covered by the ETH budget. Calls to other functions on an allowlisted contract (for example a router) are allowed by design, so **only allowlist contracts you trust**.
- **Proposals are never deleted.** The list only grows, and no function loops over it, so it cannot become too large to use.

## How to re-run
- **Slither:** GitHub → Actions → *Contract analysis* → *Run workflow*, or push a change under `contracts/`.
- **Solhint:** `cd contracts && npx solhint@6.2.5 contracts/OxvaVault.sol`
- **Tests:** `cd contracts && npm test`
