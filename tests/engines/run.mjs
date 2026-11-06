// npm run test:engines — the Godot and Blender import checks, each skipped when its engine is not installed.
// Engine checks run on the developer's machine by design (see docs/本地验证.md); CI does not install engines.
import { main as godot } from "./godot-import.mjs";
import { main as blender } from "./blender-import.mjs";

let failed = 0;
for (const check of [godot, blender]) {
  try {
    failed += await check();
  } catch (e) {
    console.error(e.message);
    failed++;
  }
}
console.log(failed ? `\nengine checks: ${failed} failed` : "\nengine checks: no failures (skipped engines are listed above)");
process.exit(failed ? 1 : 0);
