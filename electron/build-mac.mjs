// Builds the macOS app with electron-builder (config: electron-builder.yml). Without a signing certificate
// (CSC_LINK or CSC_NAME) the app is signed ad hoc, which Apple Silicon needs to run it at all; with one it is
// signed with it, and notarized when the APPLE_* variables are set. Extra arguments go to electron-builder,
// e.g. `npm run electron:build -- --arm64` or `-- --mac zip`.
import { spawnSync } from "node:child_process";

const extra = process.argv.slice(2);
const args = ["electron-builder", ...(extra.includes("--mac") ? [] : ["--mac"]), ...extra, "--publish", "never"];
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
