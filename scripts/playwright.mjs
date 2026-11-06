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

/** headless Chromium; PLAYWRIGHT_CHROMIUM_EXECUTABLE points at another build when the bundled one is missing */
export async function launchChromium(options = {}) {
  const { chromium } = loadPlaywright();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  return chromium.launch({ ...options, ...(executablePath ? { executablePath } : {}) });
}
