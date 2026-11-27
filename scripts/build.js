// Builds the static site in public/ from src/.
//   src/<page>.html -> public/<page>/index.html (index.html -> public/index.html)
//   src/assets/*    -> public/assets/*  scripts, shared CSS and brand files (logo: scripts/make-logo.js)
// Pages in src/ are written without <html>/<head>/<body> (the same format as a Claude artifact);
// this script wraps each one into a full document, and replaces <!-- @nav --> and <!-- @footer -->
// with src/partials/nav.html and src/partials/footer.html. {{LIVE_VAULT}} becomes the address of the owner’s example vault
// on mainnet, read from contracts/deployments/mainnet.json (the entry marked "showcase": true, else the first one).
// Server functions live in netlify/functions and are deployed by Netlify, not by this script.
// Usage: node scripts/build.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const outDir = path.join(root, 'public');

const PAGES = [
  { key: 'home', src: 'index.html', out: 'index.html', ogTitle: 'Oxva: reads the market, guards every move' },
  { key: 'calls', src: 'calls.html', out: path.join('calls', 'index.html'), ogTitle: 'Oxva Calls: every call, graded in public' },
  { key: 'markets', src: 'markets.html', out: path.join('markets', 'index.html'), ogTitle: 'Oxva Markets: the chain at a glance' },
  { key: 'chat', src: 'chat.html', out: path.join('chat', 'index.html'), ogTitle: 'Ask Oxva' },
  { key: 'wall', src: 'wall.html', out: path.join('wall', 'index.html'), ogTitle: 'Oxva Wall: a valid transaction is not an authorized one' },
  { key: 'vault', src: 'vault.html', out: path.join('vault', 'index.html'), ogTitle: 'Oxva Vault: put your agent’s money behind the wall' },
  { key: 'read', src: 'read.html', out: path.join('read', 'index.html'), ogTitle: 'Oxva Read: read a token, then decide' },
  { key: 'docs', src: 'docs.html', out: path.join('docs', 'index.html'), ogTitle: 'Oxva Docs: how Oxva works' },
  { key: 'status', src: 'status.html', out: path.join('status', 'index.html'), ogTitle: 'Oxva Status: every batch of calls, on the record' },
  { key: 'terms', src: 'terms.html', out: path.join('terms', 'index.html'), ogTitle: 'Oxva Terms, in plain words' },
  // Netlify serves public/404.html for any address that does not exist; kept out of search and the sitemap
  { key: 'notfound', src: '404.html', out: '404.html', ogTitle: 'Oxva: page not found', noindex: true }
];
const PARTIALS = {
  nav: fs.readFileSync(path.join(srcDir, 'partials', 'nav.html'), 'utf8').replace(/\r\n/g, '\n').trim(),
  footer: fs.readFileSync(path.join(srcDir, 'partials', 'footer.html'), 'utf8').replace(/\r\n/g, '\n').trim()
};

// The owner’s example vault on Robinhood Chain mainnet, linked as “See a live vault”.
function liveVault() {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(root, 'contracts', 'deployments', 'mainnet.json'), 'utf8'));
    const pick = list.find((d) => d.showcase) || list[0];
    if (pick && /^0x[0-9a-fA-F]{40}$/.test(pick.address)) return pick.address;
  } catch (e) { /* no mainnet deployment recorded */ }
  return '';
}
const LIVE_VAULT = liveVault();
if (!LIVE_VAULT) console.warn('No example vault in contracts/deployments/mainnet.json: the live-vault links will open the empty mainnet page.');

// The $OXVA switch (src/token.json): pages keep the "soon" or the "live" half of each @token block.
const { readToken, applyToken } = require('../lib/token.js');
const TOKEN = readToken();
console.log('$OXVA: ' + (TOKEN.live ? 'live, contract ' + TOKEN.address : 'not launched'));

// The site's public address, used for share links and the share picture (social apps need a full URL).
// Netlify sets URL to the site's main address at build time, so a custom domain is picked up by itself once it is added.
const SITE_URL = (process.env.OXVA_SITE_URL || process.env.URL || 'https://oxvaagent.com').replace(/\/+$/, '');
const OG_IMAGE = SITE_URL + '/assets/brand/og-image.png'; // made by: node tools/og/render.js

const DEFAULT_DESC = 'Oxva reads onchain markets, makes a call on every token every four hours, and checks every transaction an agent proposes before it is signed.';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function wrap(raw, page) {
  raw = applyToken(raw, TOKEN);
  const cut = raw.indexOf('</style>') + '</style>'.length;
  if (cut < 8) throw new Error(page.src + ': no </style> found');
  let head = raw.slice(0, cut);
  const body = raw.slice(cut).trim().replace(/<!-- @(nav|footer) -->/g, (_, k) => PARTIALS[k]).replace(/{{LIVE_VAULT}}/g, LIVE_VAULT);

  // description: take it from the page if it has one, so it is not written twice
  let desc = DEFAULT_DESC;
  head = head.replace(/<meta name="description" content="([^"]*)">\n?/, (_, d) => { desc = d; return ''; });
  // artifact-only tag
  head = head.replace(/<meta name="claude:viewport-fit-sides"[^>]*>\n?/, '');
  // resets the artifact host normally supplies
  head = head.replace('*{box-sizing:border-box}', '*{box-sizing:border-box}\nhtml,body{margin:0}\nimg{max-width:100%}\n[hidden]{display:none!important}');

  const pageUrl = page.key === 'home' ? '/' : '/' + page.key + '/';
  const seo = page.noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${SITE_URL}${pageUrl}">`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#060807">
${seo}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Oxva">
<meta property="og:url" content="${SITE_URL}${page.noindex ? '/' : pageUrl}">
<meta property="og:title" content="${esc(page.ogTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:secure_url" content="${OG_IMAGE}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Oxva: reads the market, guards every move. Robinhood Chain onchain agent.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@oxvaagent">
<meta name="twitter:title" content="${esc(page.ogTitle)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${OG_IMAGE}">
<link rel="icon" href="/assets/brand/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="Oxva calls" href="/calls.xml">
${head}
</head>
<body data-page="${page.key}">
${body}
</body>
</html>
`;
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name), b = path.join(to, entry.name);
    if (entry.isDirectory()) n += copyDir(a, b);
    else { fs.copyFileSync(a, b); n++; }
  }
  return n;
}

// start clean so deleted pages do not linger
fs.rmSync(outDir, { recursive: true, force: true });

for (const page of PAGES) {
  // normalize Windows line endings so the output is the same on every machine
  const raw = fs.readFileSync(path.join(srcDir, page.src), 'utf8').replace(/\r\n/g, '\n');
  const html = wrap(raw, page);
  const dest = path.join(outDir, page.out);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html);
  console.log('Built public/' + page.out.replace(/\\/g, '/') + ' (' + html.length + ' bytes)');
}
const n = copyDir(path.join(srcDir, 'assets'), path.join(outDir, 'assets'));
console.log('Copied ' + n + ' asset file' + (n === 1 ? '' : 's') + ' to public/assets');

// robots.txt and sitemap.xml, so search engines find every page (full URLs from SITE_URL, like the share tags)
const today = new Date().toISOString().slice(0, 10);
const listed = PAGES.filter((pg) => !pg.noindex);
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...listed.map((pg) => '  <url><loc>' + SITE_URL + (pg.key === 'home' ? '/' : '/' + pg.key + '/') + '</loc><lastmod>' + today + '</lastmod></url>'),
  '</urlset>', ''
].join('\n');
fs.writeFileSync(path.join(outDir, 'sitemap.xml'), sitemap);
fs.writeFileSync(path.join(outDir, 'robots.txt'), ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', 'Sitemap: ' + SITE_URL + '/sitemap.xml', ''].join('\n'));
console.log('Wrote public/sitemap.xml (' + listed.length + ' pages) and public/robots.txt');
