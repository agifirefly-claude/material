/* FBX models load through the same function as OBJ and glTF (a hand written ASCII FBX quad) */
import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadModelGeometry } from "../../src/ui/paint/meshes";

it("loads an FBX model as one geometry with uvs", async () => {
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(__dirname, "../fixtures/quad.fbx")));
  const g = await loadModelGeometry("quad.fbx", bytes);
  // the quad, split into two triangles
  expect(g.attributes.position.count).toBe(6);
  expect(g.attributes.uv).toBeTruthy();
  expect(g.attributes.normal).toBeTruthy();
});
