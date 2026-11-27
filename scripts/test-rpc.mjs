// Tests for the read-only RPC relay (netlify/functions/rpc.mjs). Offline: refusals are checked without the network,
// and allowed reads are checked against a stubbed upstream. Run: node scripts/test-rpc.mjs
import assert from "node:assert/strict";

const { default: handler } = await import("../netlify/functions/rpc.mjs");
const site = "https://oxvaagent.com";
let upstreamCalls = [];
globalThis.fetch = async (url, init) => { upstreamCalls.push({ url, body: init.body }); return new Response('{"jsonrpc":"2.0","id":1,"result":"0x1"}', { status: 200 }); };

const req = (body, { headers = {}, net = "mainnet", method = "POST" } = {}) => handler(
  new Request(`${site}/api/rpc/${net}`, { method, headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", origin: site, ...headers }, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }),
  { params: { net } }
);
const call = (method, params = []) => ({ jsonrpc: "2.0", id: 1, method, params });

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log("  ok  ", name); }

await check("a read on mainnet reaches Robinhood's mainnet RPC", async () => {
  upstreamCalls = [];
  const r = await req(call("eth_blockNumber"));
  assert.equal(r.status, 200);
  assert.equal(upstreamCalls[0].url, "https://rpc.mainnet.chain.robinhood.com");
});
await check("a read on testnet reaches the testnet RPC", async () => {
  upstreamCalls = [];
  assert.equal((await req(call("eth_chainId"), { net: "testnet" })).status, 200);
  assert.equal(upstreamCalls[0].url, "https://rpc.testnet.chain.robinhood.com");
});
await check("a batch of reads passes", async () => {
  assert.equal((await req([call("eth_getCode", ["0x0", "latest"]), call("eth_getLogs", [{}])])).status, 200);
});
await check("sending a transaction is refused, alone or hidden in a batch", async () => {
  upstreamCalls = [];
  for (const m of ["eth_sendRawTransaction", "eth_sendTransaction", "eth_sign", "personal_sign", "eth_signTypedData_v4"]) {
    assert.equal((await req(call(m))).status, 403, m);
    assert.equal((await req([call("eth_blockNumber"), call(m)])).status, 403, m + " in batch");
  }
  assert.equal(upstreamCalls.length, 0, "nothing reached the RPC");
});
await check("other websites are refused", async () => {
  assert.equal((await req(call("eth_blockNumber"), { headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" } })).status, 403);
  assert.equal((await req(call("eth_blockNumber"), { headers: { origin: "https://evil.example" } })).status, 403);
});
await check("unknown networks, GET, bad JSON, huge bodies and huge batches are refused", async () => {
  assert.equal((await req(call("eth_blockNumber"), { net: "base" })).status, 404);
  assert.equal((await req(null, { method: "GET" })).status, 405);
  assert.equal((await req("{not json")).status, 400);
  assert.equal((await req("x".repeat(40000))).status, 413);
  assert.equal((await req(Array.from({ length: 30 }, () => call("eth_blockNumber")))).status, 413);
  assert.equal((await req([])).status, 413);
});

console.log(`\n${passed}/${passed} rpc relay tests passed`);
