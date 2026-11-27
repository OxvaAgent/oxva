// POST /api/rpc/mainnet and /api/rpc/testnet: a read-only relay to Robinhood Chain's public RPC.
//
// Why: the public RPC sometimes answers browsers with a doubled CORS header ("*,*"), which the browser rejects, so the
// vault page could not read a vault for a few seconds at a time. Server to server there is no CORS, so the page falls
// back to this relay when a direct read fails.
// Only read methods pass, only from Oxva's own pages, with small request sizes. Nothing here can sign or send a
// transaction: writes always go from the visitor's own wallet.
const RPC = {
  mainnet: "https://rpc.mainnet.chain.robinhood.com",
  testnet: "https://rpc.testnet.chain.robinhood.com"
};
const READ_METHODS = new Set([
  "eth_chainId", "net_version", "eth_blockNumber", "eth_getCode", "eth_getBalance", "eth_call", "eth_getLogs",
  "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber", "eth_getTransactionCount",
  "eth_gasPrice", "eth_feeHistory", "eth_maxPriorityFeePerGas", "eth_estimateGas"
]);
const MAX_BODY = 32 * 1024;
const MAX_BATCH = 25;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req, context) => {
  const net = context.params && context.params.net;
  const upstream = RPC[net];
  if (!upstream) return json(404, { error: "Unknown network. Use mainnet or testnet." });
  if (req.method !== "POST") return json(405, { error: "POST a JSON-RPC request." });

  // Oxva's own pages only (browsers always send these on a cross-site request)
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  const self = new URL(req.url).origin;
  if ((site && site !== "same-origin") || (origin && origin !== self)) return json(403, { error: "Only Oxva's own pages may use this relay." });

  const body = await req.text();
  if (!body || body.length > MAX_BODY) return json(413, { error: "Request too large." });
  let msg;
  try { msg = JSON.parse(body); } catch (e) { return json(400, { error: "Not JSON." }); }
  const list = Array.isArray(msg) ? msg : [msg];
  if (!list.length || list.length > MAX_BATCH) return json(413, { error: "Too many calls in one batch." });
  if (!list.every((m) => m && typeof m.method === "string" && READ_METHODS.has(m.method))) return json(403, { error: "Only read methods are relayed." });

  try {
    const r = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(15000) });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    return json(502, { error: "Robinhood Chain's RPC did not answer." });
  }
};

export const config = { path: "/api/rpc/:net" };
