# Oxva

**Reads the market, makes the call, guards every move.**

Oxva is an onchain agent with two jobs. Every four hours it reads the market and makes a call on each token it watches, and every call is graded in public afterwards. It also stands between AI agents and their money: an Oxva Vault lets an agent spend only inside rules its owner sets, enforced by a smart contract.

Website: <https://oxvaagent.com> · Docs: <https://oxvaagent.com/docs/> · X: [@oxvaagent](https://x.com/oxvaagent) · Telegram: coming soon

## What it does

| Feature | What it is | Status |
|---|---|---|
| **Calls** | BUY, SELL, WAIT or AVOID on each watched token every four hours, with an entry zone, an invalidation price, a conviction from 1 to 5 and the main risk | Live |
| **Track record** | Every call is graded against the price for three days: working, against or invalidated. Nothing is deleted; old calls move to a monthly archive | Live |
| **Markets** | Price, liquidity and volume for every watched token, next to its latest call | Live |
| **Read a token** | Paste a token on Robinhood Chain, Ethereum, BNB Chain, Base, Arbitrum or Polygon: a market read plus nine contract checks | Live |
| **Chat** | Ask Oxva about a token or a call; a Claude model answers from live data | Live |
| **The wall** | A policy engine for agent transactions (budget, caps, allowlist, slippage, replay, approvals), as a browser simulator | Demo |
| **Oxva Vault** | The wall as a smart contract you own: the agent proposes, the contract allows, holds for your approval, or refuses | Testnet, and mainnet as an unaudited beta |
| **$OXVA** | A token for this agent is an idea, not a product. Nothing has launched and no contract exists | Not launched |

Calls and reads are automated readings of public data, made by fixed rules. They are not financial advice.

## Oxva Vault

- Contract: [`contracts/contracts/OxvaVault.sol`](contracts/contracts/OxvaVault.sol) (Solidity 0.8.28).
- The owner sets an hourly budget, a cap per call, an approval threshold and an allowlist. The agent can only propose: small calls inside the rules go through, larger ones wait for the owner, anything else is refused. The agent can never move tokens; the owner can pause and withdraw at any time.
- Visitors create their own vaults from <https://oxvaagent.com/vault/> with their own wallets. Oxva holds no keys.
- The vault page checks that a vault's code is exactly this build and shows "Verified Oxva code".
- **Not audited.** The contract passes 21 tests, including a model-based random test of 900 actions, and an automated analysis with Slither and Solhint ([`contracts/ANALYSIS.md`](contracts/ANALYSIS.md)). No outside firm has reviewed it. On mainnet a bug could lose funds: try it on testnet first.

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | <https://robinhoodchain.blockscout.com> | <https://explorer.testnet.chain.robinhood.com> |

Example vault on mainnet: [`0xa38724bE1e75FA99dC09D539ee7cfc044b35aB14`](https://robinhoodchain.blockscout.com/address/0xa38724bE1e75FA99dC09D539ee7cfc044b35aB14).

## Run it

```bash
npm install
npm test               # the rules: contract checks, market read, calls, the wall, the RPC relay
node scripts/build.js  # builds public/ from src/

cd contracts
npm install
npm test               # vault tests, including the random model test
```

The site is static (`public/`) with a few Netlify Functions (`netlify/functions/`): the calls API and its four-hourly run, the chat, and a read-only RPC relay. The chat needs an `ANTHROPIC_API_KEY` set in the hosting environment; no key is in this repository.

## Layout

| Path | What it is |
|---|---|
| `src/` | Pages and browser code (`src/assets/`). `scripts/build.js` builds them into `public/`. |
| `src/assets/gate-core.js` | The nine contract checks. |
| `src/assets/read-core.js` | The market read: lean, conviction, reason, the catch. |
| `src/assets/wall-core.js` | The wall's policy engine. |
| `lib/calls-core.js` | Makes and grades calls; the track record. |
| `netlify/functions/` | Calls API, scheduled calls run, chat, RPC relay. |
| `contracts/` | Oxva Vault (Hardhat): contract, tests, deploy and manage scripts, deployments, analysis report. |
| `tools/` | Bundlers for vendored libraries and the share picture. |

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
