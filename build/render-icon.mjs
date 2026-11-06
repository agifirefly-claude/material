// Renders build/icon.svg to build/icon.png (1024×1024), which electron-builder turns into the .icns.
// Usage: node build/render-icon.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// playwright: the project's own or a global install
const { chromium } = createRequire(import.meta.url)("playwright");

const dir = path.dirname(new URL(import.meta.url).pathname);
const svg = fs.readFileSync(path.join(dir, "icon.svg"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator("svg").screenshot({ path: path.join(dir, "icon.png"), omitBackground: true });
await browser.close();
