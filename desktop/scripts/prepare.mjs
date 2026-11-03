// Copies the shared single-file UI into the desktop bundle. The same page-aura.html
// runs standalone in a browser and inside the desktop app (it detects Tauri at runtime).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const out = resolve(here, "..", "dist");
mkdirSync(out, { recursive: true });
copyFileSync(resolve(root, "page-aura.html"), resolve(out, "index.html"));
console.log("Copied page-aura.html -> desktop/dist/index.html");
