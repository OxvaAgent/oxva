// Builds src/assets/vendor/walletconnect.js: one self-contained browser file, served from Oxva's own domain.
// AppKit (Reown's ready-made modal) is left out on purpose: Oxva draws its own QR code, so the page never
// loads images, fonts or scripts from other domains. Run: npm run build
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const out = path.join(__dirname, "..", "..", "src", "assets", "vendor", "walletconnect.js");

const noAppKit = {
  name: "no-appkit",
  setup(build) {
    build.onResolve({ filter: /^@reown\/appkit(\/.*)?$/ }, (args) => ({ path: args.path, namespace: "no-appkit" }));
    build.onLoad({ filter: /.*/, namespace: "no-appkit" }, () => ({
      contents: "export function createAppKit(){ throw new Error('AppKit is not bundled: Oxva draws its own QR code (showQrModal must stay false).'); }",
      loader: "js"
    }));
  }
};

esbuild.build({
  entryPoints: [path.join(__dirname, "entry.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  legalComments: "eof",
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  plugins: [noAppKit],
  outfile: out,
  logLevel: "warning"
}).then(() => {
  const pkg = (n) => require(path.join(__dirname, "node_modules", n, "package.json")).version;
  const size = fs.statSync(out).size;
  fs.appendFileSync(path.join(path.dirname(out), "README.md"),
    `walletconnect.js bundles @walletconnect/ethereum-provider ${pkg("@walletconnect/ethereum-provider")} (Apache-2.0) and qrcode-generator ${pkg("qrcode-generator")} (MIT), built by tools/walletconnect/build.js.\n`);
  console.log("built src/assets/vendor/walletconnect.js (" + size + " bytes)");
}).catch((e) => { console.error(e.message); process.exit(1); });
