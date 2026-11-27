// Builds src/assets/vendor/three-oxva.js: one self-contained browser file, served from Oxva's own domain
// (the CSP allows scripts from 'self' only). Run: npm install && npm run build
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const out = path.join(__dirname, "..", "..", "src", "assets", "vendor", "three-oxva.js");
esbuild.build({
  entryPoints: [path.join(__dirname, "entry.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  legalComments: "eof",
  outfile: out,
  logLevel: "warning"
}).then(() => {
  const v = require(path.join(__dirname, "node_modules", "three", "package.json")).version;
  const readme = path.join(path.dirname(out), "README.md");
  const line = `three-oxva.js bundles three.js ${v} (MIT): WebGL renderer, extrusion, materials, SVGLoader and RoomEnvironment, built by tools/three/build.js.\n`;
  const text = fs.existsSync(readme) ? fs.readFileSync(readme, "utf8") : "";
  fs.writeFileSync(readme, text.split("\n").filter((l) => l && !l.startsWith("three-oxva.js")).join("\n") + "\n" + line);
  console.log("built src/assets/vendor/three-oxva.js (" + fs.statSync(out).size + " bytes)");
}).catch((e) => { console.error(e.message); process.exit(1); });
