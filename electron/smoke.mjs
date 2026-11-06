// Runs the desktop app's self test (electron/selftest.cjs) on the current build in dist/.
// Linux without a display runs it under xvfb-run. Usage: npm run build && npm run electron:smoke [-- path/to/app-binary]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "material-pro-smoke-"));
const result = path.join(dir, "selftest.json");
const binary = process.argv[2];
let cmd = binary ?? require("electron");
let args = binary ? [] : [path.join(root, "electron", "main.cjs")];
// Chromium refuses to run as root with its sandbox (containers, CI)
if (process.getuid?.() === 0) args.push("--no-sandbox");
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
