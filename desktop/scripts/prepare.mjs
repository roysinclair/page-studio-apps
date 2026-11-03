// Copies a single-file UI into the desktop bundle. The same Rust core builds two apps:
//   node scripts/prepare.mjs         -> Page Aura  (page-aura.html  -> dist/index.html)
//   node scripts/prepare.mjs orbit   -> Page Orbit (page-orbit.html -> dist-orbit/index.html)
// Each page runs standalone in a browser too; it detects the desktop app at runtime.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const orbit = process.argv[2] === "orbit";
const src = orbit ? "page-orbit.html" : "page-aura.html";
const out = resolve(here, "..", orbit ? "dist-orbit" : "dist");
mkdirSync(out, { recursive: true });
copyFileSync(resolve(root, src), resolve(out, "index.html"));
console.log(`Copied ${src} -> ${orbit ? "dist-orbit" : "dist"}/index.html`);
