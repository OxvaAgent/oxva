# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue:

1. Go to the **Security** tab of this repository.
2. Choose **Report a vulnerability** (GitHub private vulnerability reporting).
3. Describe the problem and, if you can, attach a test that shows it.

Only the Oxva team and you can see the report. We reply there, agree on a fix, and publish an advisory together with you once the fix is live.

Oxva will never ask for your seed phrase or private key. Anyone who does is a scammer.

## Scope

- The smart contract in `contracts/contracts/OxvaVault.sol` and its deployed copies (the vault page shows "Verified Oxva code" for them).
- The website <https://oxvaagent.com>, its API (`/api/calls`, `/api/chat`, `/api/rpc/*`) and the vault page.

## Status

The vault contract has **not been audited** by an outside firm. It has unit tests, a model-based random test and an automated analysis (Slither, Solhint), described in [`contracts/ANALYSIS.md`](contracts/ANALYSIS.md). On mainnet it is a beta: only put in what you can afford to lose.
