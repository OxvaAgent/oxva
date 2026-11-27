// The $OXVA switch: reads src/token.json and checks it. Used by scripts/build.js (pages) and scripts/test-token.js.
// The chat (netlify/functions/chat.mjs) imports the same JSON file and applies the same rule.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'src', 'token.json');
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Returns the token state for the pages. Throws on a bad file, so a typo can never put a wrong address live. */
function readToken(file = FILE) {
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (t.status !== 'soon' && t.status !== 'live') throw new Error('src/token.json: status must be "soon" or "live", not ' + JSON.stringify(t.status));
  if (t.status === 'soon') return { live: false };
  const address = String(t.address || '').trim();
  if (!ADDRESS.test(address)) throw new Error('src/token.json: status is "live" but address is not a contract address (0x + 40 hex characters)');
  const launched = String(t.launched || '').trim();
  if (launched && !DAY.test(launched)) throw new Error('src/token.json: launched must look like 2026-11-27');
  return {
    live: true,
    address,
    short: address.slice(0, 6) + '…' + address.slice(-4),
    launched,
    explorer: 'https://robinhoodchain.blockscout.com/token/' + address,
    chart: 'https://dexscreener.com/robinhood/' + address,
    read: '/read/?t=' + address + '&c=robinhood'
  };
}

/** Keeps the right half of every  <!-- @token:soon --> … <!-- @token:live --> … <!-- @token:end -->  block and fills the {{TOKEN_*}} fields. */
function applyToken(html, tok) {
  const BLOCK = /<!-- @token:soon -->([\s\S]*?)<!-- @token:live -->([\s\S]*?)<!-- @token:end -->/g;
  let out = html.replace(BLOCK, (_, soon, live) => (tok.live ? live : soon));
  if (/<!-- @token:(soon|live|end) -->/.test(out)) throw new Error('A @token block is not closed (needs @token:soon, @token:live, @token:end in that order)');
  if (tok.live) {
    out = out.replace(/{{TOKEN_CA}}/g, tok.address).replace(/{{TOKEN_SHORT}}/g, tok.short)
      .replace(/{{TOKEN_EXPLORER}}/g, tok.explorer).replace(/{{TOKEN_CHART}}/g, tok.chart)
      .replace(/{{TOKEN_READ}}/g, tok.read).replace(/{{TOKEN_SINCE}}/g, tok.launched ? 'Since ' + tok.launched : 'Live');
  }
  if (/{{TOKEN_[A-Z]+}}/.test(out)) throw new Error('A {{TOKEN_…}} field is used outside a @token:live block');
  return out;
}

module.exports = { readToken, applyToken, ADDRESS };
