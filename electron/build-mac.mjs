// Builds the macOS app with electron-builder (config: electron-builder.yml). Without a signing certificate
// (CSC_LINK or CSC_NAME) the app is signed ad hoc, which Apple Silicon needs to run it at all; with one it is
// signed with it, and notarized when the APPLE_* variables are set. Extra arguments go to electron-builder,
// e.g. `npm run electron:build -- --arm64` or `-- --mac zip`.
//
// Electron itself is downloaded here, not by electron-builder: electron-builder verifies its download against the
// release's SHASUMS256.txt, which GitHub has been answering with 504 for Electron v45.2.3, failing every build.
// The zips are checked against the SHA-256 sums the electron npm package ships (node_modules/electron/checksums.json)
// and handed over as electronDist.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const extra = process.argv.slice(2);
const args = ["electron-builder", ...(extra.includes("--mac") ? [] : ["--mac"]), ...extra, "--publish", "never"];

/** the Electron zips the build needs, downloaded once into release/electron-dist and verified */
function electronDist() {
  const version = require("electron/package.json").version;
  const sums = require("electron/checksums.json");
  const asked = ["arm64", "x64", "universal"].filter((a) => extra.includes(`--${a}`));
  const archs = asked.includes("universal") || !asked.length ? ["arm64", "x64"] : asked;
  const dir = path.join(root, "release", "electron-dist");
  fs.mkdirSync(dir, { recursive: true });
  for (const arch of archs) {
    const name = `electron-v${version}-darwin-${arch}.zip`;
    const file = path.join(dir, name);
    const want = sums[name];
    if (!want) throw new Error(`no checksum for ${name} in electron/checksums.json`);
    const sha = () => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (!fs.existsSync(file) || sha() !== want) {
      // GitHub first, then a mirror (ELECTRON_MIRROR, as @electron/get reads it, or npmmirror): the checksum decides
      const mirror = (process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/").replace(/\/?$/, "/");
      const urls = [`https://github.com/electron/electron/releases/download/v${version}/${name}`, `${mirror}${version}/${name}`];
      let ok = false;
      for (const url of urls) {
        console.log(`Downloading ${url}`);
        const r = spawnSync("curl", ["-fsSL", "--retry", "5", "--retry-all-errors", "-o", file, url], { stdio: "inherit" });
        if (r.status === 0 && sha() === want) {
          ok = true;
          break;
        }
        if (fs.existsSync(file)) fs.rmSync(file);
        console.log(r.status === 0 ? `${name} from ${url} does not match its SHA-256, discarded` : `could not download ${url}`);
      }
      if (!ok) throw new Error(`could not get a verified ${name}`);
    }
    console.log(`${name}: SHA-256 verified`);
  }
  return dir;
}
args.push(`-c.electronDist=${electronDist()}`);
const env = { ...process.env };
// CI passes unset secrets as empty strings
for (const k of Object.keys(env)) if ((k.startsWith("CSC_") || k.startsWith("APPLE_")) && !env[k]) delete env[k];
if (!env.CSC_LINK && !env.CSC_NAME) {
  args.push("-c.mac.identity=-");
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  console.log("No signing certificate (CSC_LINK / CSC_NAME): building an unsigned (ad hoc signed) app");
}
const r = spawnSync("npx", args, { stdio: "inherit", env, shell: process.platform === "win32" });
process.exit(r.status ?? 1);
