// Browser checks of things the harness does not cover: the AgX tone mapper against Godot's formulas, and Auto Export
// writing through the File System Access API (with the picker and the file replaced by an in-page fake).
import { createRequire } from "node:module";
import { createServer } from "vite";
import validator from "gltf-validator";
const { chromium } = createRequire(import.meta.url)("playwright");
const port = +(process.env.E2E_PORT ?? 5198);
const URL = "http://127.0.0.1:" + port;
const server = await createServer({ server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const b = await chromium.launch();
let failed = false;
const fail = (m) => { console.log("FAIL " + m); failed = true; };

console.log("== AgX");
await (async () => {
  const p = await b.newPage();
  await p.goto(URL + '/?lang=en'); await p.waitForTimeout(4000);
  const r = await p.evaluate(async () => {
    const src = (await import('/src/ui/preview3d/postprocess.ts?raw')).default;
    const a0 = src.indexOf('vec3 agx('); const fn = src.slice(a0, src.indexOf('void main() {', a0));
    const c = document.createElement('canvas'); c.width = 4; c.height = 1; const gl = c.getContext('webgl2');
    gl.getExtension('EXT_color_buffer_float');
    const vs = '#version 300 es\nin vec2 p; void main(){ gl_Position=vec4(p,0,1);}';
    const fs = '#version 300 es\nprecision highp float; out vec4 o;\n' + fn + '\nvoid main(){ float i = floor(gl_FragCoord.x); vec3 inp = i==0.0? vec3(0.05,0.1,0.2) : i==1.0? vec3(0.18) : i==2.0? vec3(1.0,0.5,0.25) : vec3(8.0,4.0,2.0); o = vec4(agx(inp, 16.29, 1.25), 1.0);}';
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(x); return x; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr); gl.useProgram(pr);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 4, 1);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.viewport(0,0,4,1); gl.drawArrays(gl.TRIANGLES,0,3);
    const out = new Float32Array(16); gl.readPixels(0,0,4,1,gl.RGBA,gl.FLOAT,out); return Array.from(out);
  });
  // reference: Godot's C++ parameters and GLSL curve, transcribed literally (GLSL mat3 is column major)
  const W = 16.29, C = 1.25, cross = 0.18, max = 1.0, shoulder = max - cross;
  const hi = Math.max(2, W) * max, toe = (1 / cross - 1) * Math.pow(cross, C);
  const den = Math.pow(cross, C) + toe, slope = (C * Math.pow(cross, C - 1) * toe) / (den * den);
  let w = hi - cross; w = (w * w) / shoulder * slope;
  const inset = [0.544814746488245, 0.140416948464053, 0.0888104196149096, 0.373787398372697, 0.754137554567394, 0.178871756420858, 0.0813978551390581, 0.105445496968552, 0.732317823964232];
  const outset = [1.96488741169489, -0.299313364904742, -0.164352742528393, -0.855988495690215, 1.32639796461980, -0.238183969428088, -0.108898916004672, -0.0270845997150571, 1.40253671195648];
  const mul = (m, v) => [0, 1, 2].map(r => m[r] * v[0] + m[3 + r] * v[1] + m[6 + r] * v[2]);
  const curve = x => { if (x < cross) { const t = Math.pow(x, C); return t / (t + toe); } const s = x - cross, ss = slope * s; return ss * (1 + s / w) / (1 + ss / shoulder) + cross; };
  const ref = v => mul(outset, mul(inset, v).map(curve).map(x => Math.min(max, x)));
  const ins = [[0.05, 0.1, 0.2], [0.18, 0.18, 0.18], [1, 0.5, 0.25], [8, 4, 2]];
  let worst = 0;
  ins.forEach((v, i) => { const e = ref(v); for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(e[k] - r[i * 4 + k])); console.log(v.join(','), '→ gpu', r.slice(i * 4, i * 4 + 3).map(x => x.toFixed(5)).join(','), ' godot', e.map(x => x.toFixed(5)).join(',')); });
  console.log('max abs difference', worst.toExponential(2));
  if (worst > 1e-5) fail('AgX differs from Godot by ' + worst);
  await p.close();
})();

console.log("== Auto export");
await (async () => {
    const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    localStorage.clear();
    window.__writes = [];
    window.showSaveFilePicker = async (opts) => ({
      name: opts.suggestedName,
      createWritable: async () => {
        const parts = [];
        return { write: async (blob) => parts.push(blob), close: async () => { const bl = new Blob(parts); const head = new Uint8Array(await bl.slice(0, 8).arrayBuffer()); window.__writes.push({ size: bl.size, head: Array.from(head), hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', await bl.arrayBuffer()))).slice(0, 6).join('.') }); } };
      },
    });
  });
  await p.goto(URL + '/?lang=en');
  await p.waitForTimeout(5000);
  await p.evaluate(async () => {
    const { createGen, newProject } = await import('/src/engine/loader.ts');
    const ed = window.mmEditor;
    ed.openProject(newProject(), 'autoexport test');
    const g = ed.graph;
    const noise = createGen({ type: 'perlin', name: 'perlin' }); noise.position = { x: -400, y: 0 }; g.addGenerator(noise);
    const ae = createGen({ type: 'autoexport', name: 'autoexport' }); ae.position = { x: -100, y: 0 }; g.addGenerator(ae);
    ae.setParameter('size', 8);
    ae.setParameter('filename', 'noise.png');
    g.connectChildren(noise, 0, ae, 0);
  });
  await p.waitForTimeout(1500);
  await p.locator('.react-flow__controls-fitview').click();
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: 'Choose file…' }).click();
  await p.waitForTimeout(1500);
  console.log('after choosing the file:', JSON.stringify(await p.evaluate(() => window.__writes)));
  await p.evaluate(() => window.mmEditor.graph.getNode('perlin').setParameter('scale_x', 9));
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.mmEditor.graph.getNode('Material').setParameter('roughness', 0.3));
  await p.waitForTimeout(1500);
  const w = await p.evaluate(() => window.__writes);
  console.log('after changing the noise, then an unrelated node:', JSON.stringify(w));
  console.log('png signature ok:', w.every((x) => x.head.join(',') === '137,80,78,71,13,10,26,10'), '| writes:', w.length, '| contents differ:', w.length >= 2 && w[0].hash !== w[1].hash);
  console.log('button now says:', await p.locator('.autoexport button').first().textContent());
  console.log(errs.join('\n'));
  if (!(w.length === 2 && w[0].hash !== w[1].hash && w.every((x) => x.head.join(',') === '137,80,78,71,13,10,26,10'))) fail('auto export wrote ' + w.length + ' files');
  if (errs.length) fail(errs.join('; '));
  await p.close();
})();

console.log("== New exports: m3e material, Cocos Creator, glTF");
await (async () => {
  const p = await b.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(URL + "/?lang=en&example=bricks");
  await p.waitForTimeout(5000);
  const r = await p.evaluate(async () => {
    const { buildM3eMaterial } = await import("/src/export/m3eMaterial.ts");
    const { openMaterialFile } = await import("/src/formats/m3e-material.ts");
    const { cocosFiles, glbFile } = await import("/src/export/engines.ts");
    const { findMaterial } = await import("/src/engine/materialMaps.ts");
    const ed = window.mmEditor;
    const m = findMaterial(ed.root);
    const out = {};
    // m3e: what the exporter writes is what the format's reader keeps, whole
    const file = await buildM3eMaterial(ed.renderer, m, { name: "bricks", tile: 128, resolution: 128, light: { azimuth: 315, elevation: 45 }, rawMaps: true, format: "png", project: "{}" });
    const back = openMaterialFile(JSON.parse(JSON.stringify(file)));
    out.m3e = { valid: !!back, same: !!back && JSON.stringify(back[0].maps) === JSON.stringify(file.materials[0].maps), maps: Object.keys(file.materials[0].maps) };
    // Cocos: every texture the material refers to is an image whose meta has that sub asset
    const files = await cocosFiles(ed.renderer, m, "bricks", 128);
    const dec = (b) => JSON.parse(new TextDecoder().decode(b));
    const mtl = dec(files["bricks/bricks.mtl"]);
    const metas = Object.keys(files).filter((k) => k.endsWith(".png.meta")).map((k) => dec(files[k]));
    const refs = Object.values(mtl._props[0]).filter((v) => v && v.__uuid__).map((v) => v.__uuid__);
    out.cocos = {
      files: Object.keys(files),
      effect: mtl._effectAsset.__uuid__,
      refsResolved: refs.every((u) => metas.some((mt) => mt.subMetas["6c48a"].uuid === u)),
      refs: refs.length,
      defines: mtl._defines[0],
      passes: mtl._defines.length,
      pngs: Object.keys(files).filter((k) => k.endsWith(".png")).every((k) => files[k][0] === 0x89 && files[k][1] === 0x50),
    };
    const glb = await glbFile(ed.renderer, m, "bricks", 128, "plane");
    out.glb = Array.from(glb);
    return out;
  });
  console.log("m3e:", JSON.stringify(r.m3e));
  if (!r.m3e.valid || !r.m3e.same) fail("the m3e material file does not read back whole");
  console.log("cocos:", JSON.stringify(r.cocos));
  if (r.cocos.effect !== "c8f66d17-351a-48da-a12c-0212d28575c4" || !r.cocos.refsResolved || r.cocos.refs < 3 || r.cocos.passes !== 6 || !r.cocos.pngs) fail("Cocos export");
  const report = await validator.validateBytes(new Uint8Array(r.glb));
  const issues = report.issues;
  console.log(`glb: ${r.glb.length} bytes, ${issues.numErrors} errors, ${issues.numWarnings} warnings, materials ${report.info?.materialCount}, textures ${report.info?.textureCount}`);
  for (const m of issues.messages.filter((x) => x.severity <= 1).slice(0, 8)) console.log("   ", m.code, m.message, m.pointer ?? "");
  if (issues.numErrors) fail("the .glb does not validate");
  if (errs.length) fail(errs.join("; "));
  await p.close();
})();

await b.close();
await server.close();
console.log(failed ? "e2e: failed" : "e2e: all passed");
process.exit(failed ? 1 : 0);
