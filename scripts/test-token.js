// Tests the $OXVA switch (lib/token.js, src/token.json). Netlify runs this before every build, so a broken
// token file stops the deploy instead of putting a wrong contract on the site.
// Usage: node scripts/test-token.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readToken, applyToken } = require('../lib/token.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ': ' + e.message); }
}
function eq(a, b) { if (a !== b) throw new Error(JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function throws(fn, re) { try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error('wrong error: ' + e.message); return; } throw new Error('did not throw'); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxva-token-'));
function file(obj) { const p = path.join(dir, Math.random().toString(36).slice(2) + '.json'); fs.writeFileSync(p, JSON.stringify(obj)); return p; }
const CA = '0x' + 'aB12'.repeat(10);
const PAGE = 'a <!-- @token:soon -->SOON<!-- @token:live -->LIVE {{TOKEN_CA}} {{TOKEN_SHORT}} {{TOKEN_SINCE}}<!-- @token:end --> b';

ok('the real src/token.json is valid', () => { readToken(); });
ok('every page has well-formed @token blocks', () => {
  const src = path.join(__dirname, '..', 'src');
  const live = { live: true, address: CA, short: 'x', launched: '', explorer: 'e', chart: 'c', read: 'r' };
  for (const f of fs.readdirSync(src).filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(src, f), 'utf8');
    applyToken(html, { live: false }); applyToken(html, live);
  }
});
ok('soon keeps the soon half', () => { eq(applyToken(PAGE, readToken(file({ status: 'soon' }))), 'a SOON b'); });
ok('live keeps the live half and fills the fields', () => {
  const t = readToken(file({ status: 'live', address: CA, launched: '2026-11-27' }));
  eq(applyToken(PAGE, t), 'a LIVE ' + CA + ' 0xaB12…aB12 Since 2026-11-27 b');
  eq(t.read, '/read/?t=' + CA + '&c=robinhood');
});
ok('live without a launch day says Live', () => { eq(applyToken(PAGE, readToken(file({ status: 'live', address: CA }))).includes('LIVE ' + CA + ' 0xaB12…aB12 Live'), true); });
ok('live with a missing address is refused', () => { throws(() => readToken(file({ status: 'live', address: '' })), /not a contract address/); });
ok('live with a short or mistyped address is refused', () => {
  throws(() => readToken(file({ status: 'live', address: CA.slice(0, 41) })), /not a contract address/);
  throws(() => readToken(file({ status: 'live', address: CA.slice(0, 41) + 'g' })), /not a contract address/);
});
ok('an unknown status is refused', () => { throws(() => readToken(file({ status: 'launched' })), /status must be/); });
ok('a bad launch day is refused', () => { throws(() => readToken(file({ status: 'live', address: CA, launched: '27/11/2026' })), /launched/); });
ok('an unclosed block is refused', () => { throws(() => applyToken('<!-- @token:soon -->x<!-- @token:live -->y', { live: false }), /not closed/); });
ok('a token field outside a live block is refused', () => { throws(() => applyToken('{{TOKEN_CA}}', { live: false }), /outside/); });

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n' + pass + '/' + (pass + fail) + ' token tests passed');
if (fail) process.exit(1);
