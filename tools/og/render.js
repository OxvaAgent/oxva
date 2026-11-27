// Renders tools/og/og.html to src/assets/brand/og-image.png (1200 x 630), the picture shown when a link is shared.
// Uses a locally installed Edge or Chrome in headless mode (needs internet for the Google font).
// Usage: node tools/og/render.js   then: node scripts/build.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = path.join(__dirname, 'og.html');
const out = path.join(root, 'src', 'assets', 'brand', 'og-image.png');
const browsers = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const exe = browsers.find((p) => fs.existsSync(p));
if (!exe) { console.error('No Chrome or Edge found. Set CHROME=/path/to/chrome.'); process.exit(1); }

execFileSync(exe, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=1200,630', '--virtual-time-budget=8000', '--allow-file-access-from-files',
  '--screenshot=' + out, require('url').pathToFileURL(html).href
], { stdio: 'inherit' });
console.log('wrote', path.relative(root, out), fs.statSync(out).size, 'bytes');
