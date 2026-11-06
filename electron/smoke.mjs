// Runs the desktop app's self test (electron/selftest.cjs) on the current build in dist/.
// Linux without a display runs it under xvfb-run. Usage: npm run build && npm run electron:smoke [-- path/to/app-binary]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** whether Electron's chrome-sandbox helper is set up as Chromium requires (root-owned, setuid) */
function suidSandbox() {
  try {
    const st = fs.statSync(path.join(path.dirname(require("electron")), "chrome-sandbox"));
    return st.uid === 0 && (st.mode & 0o4000) !== 0;
  } catch {
    return false;
  }
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "material-pro-smoke-"));
const result = path.join(dir, "selftest.json");
const binary = process.argv[2];
let cmd = binary ?? require("electron");
let args = binary ? [] : [path.join(root, "electron", "main.cjs")];
// Chromium refuses to run as root with its sandbox (containers), and on Linux its setuid sandbox helper only works
// when chrome-sandbox is owned by root with mode 4755, which npm install does not do (CI runners): the test then runs
// without the sandbox. The packaged app is not affected.
if (process.getuid?.() === 0 || (process.platform === "linux" && !binary && !suidSandbox())) args.push("--no-sandbox");
// a virtual display has no GPU: WebGL2 runs on SwiftShader, which Chromium blocks unless asked
// (CI machines too: MATERIAL_PRO_SMOKE_GPU=1 keeps the real GPU)
if (process.platform === "linux" || (process.env.CI && !process.env.MATERIAL_PRO_SMOKE_GPU)) args.push("--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-unsafe-swiftshader");
if (process.platform === "linux" && !process.env.DISPLAY) {
  args = ["-a", "-s", "-screen 0 1440x900x24", cmd, ...args];
  cmd = "xvfb-run";
}
const env = {
  ...process.env,
  MATERIAL_PRO_SELFTEST: result,
  MATERIAL_PRO_TEST_SAVE_DIR: dir,
  // a fresh profile: no saved window or recent files
  MATERIAL_PRO_USER_DATA: path.join(dir, "profile"),
};
const r = spawnSync(cmd, args, { env, stdio: "inherit", timeout: 180000 });
if (!fs.existsSync(result)) {
  console.error("no result", r.error ?? r.status);
  process.exit(1);
}
const out = JSON.parse(fs.readFileSync(result, "utf8"));
console.log(JSON.stringify(out, null, 2));
console.log("screenshot:", result.replace(/\.json$/, ".png"));
process.exit(out.ok ? 0 : 1);
