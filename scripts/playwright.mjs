// Playwright for the scripts that drive headless Chromium (the CLI, the harness, e2e tests): the project's own
// devDependency first, then a globally installed one (as in environments that ship Playwright and its browsers).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const GLOBAL = ["/opt/node-tools/node_modules/playwright", "/usr/local/lib/node_modules/playwright", "/usr/lib/node_modules/playwright"];

export function loadPlaywright() {
  for (const id of ["playwright", ...GLOBAL]) {
    try {
      return require(id);
    } catch {
      /* try the next one */
    }
  }
  throw new Error("Playwright is not installed: run `npm install` (and `npx playwright install chromium` the first time)");
}

/** machine-wide Chromium builds to try when the browser this Playwright version expects is not downloaded */
const SHARED_CHROMIUM = ["/opt/pw-browsers/chromium"];

/** headless Chromium; PLAYWRIGHT_CHROMIUM_EXECUTABLE points at another build when the bundled one is missing */
export async function launchChromium(options = {}) {
  const { chromium } = loadPlaywright();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  if (executablePath) return chromium.launch({ ...options, executablePath });
  try {
    return await chromium.launch(options);
  } catch (e) {
    if (!/Executable doesn't exist/.test(String(e))) throw e;
    const fs = await import("node:fs");
    const shared = SHARED_CHROMIUM.find((p) => fs.existsSync(p));
    if (!shared) throw e;
    return chromium.launch({ ...options, executablePath: shared, args: [...(options.args ?? []), "--no-sandbox"] });
  }
}
