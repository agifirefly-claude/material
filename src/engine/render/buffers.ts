/* The passes of Buffer and Iterate Buffer nodes (gen_buffer.gd, gen_iterate_buffer.gd) */
import type { GenBuffer, GenIterateBuffer } from "../gen/texture";
import type { ShaderCode } from "../shader-code";
import { buildFragmentShader } from "./shader-source";
import type { RenderHost } from "./host";
import { fnv, ShaderError, type Resolved, type Target } from "./types";

/** renders a ShaderCode under `key`, again only when the shader, what it reads, or (when it reads it) the time changed */
export function renderCached(host: RenderHost, key: string, sc: ShaderCode, size: number, f32: boolean, mipmap: boolean, stack: Set<string>): Resolved {
  const built = buildFragmentShader(sc);
  const deps = host.resolveUniforms(built.uniforms, stack);
  // a shader that reads the time is a new render at every new time
  const timeSig = built.body.includes("elapsed_time") ? "t" + host.time : "";
  if (timeSig) host.usedTime = true;
  const sig = fnv(built.source + "|" + deps.sig + "|" + size + f32 + mipmap + timeSig);
  const cached = host.cached(key);
  if (cached && cached.sig === sig) return { target: cached.target, sig };
  const target = host.reuse(key, size, f32, mipmap);
  try {
    host.draw(built, deps.values, target);
    host.errors.delete(key);
  } catch (e) {
    if (e instanceof ShaderError) host.errors.set(key, e);
    else throw e;
  }
  host.setCached(key, { sig, target });
  return { target, sig };
}

export function renderBuffer(host: RenderHost, g: GenBuffer, stack: Set<string>): Resolved {
  let job;
  try {
    job = g.job();
  } catch (e) {
    console.error(e);
    return { target: null, sig: "error" };
  }
  return renderCached(host, g.genName + "_tex", job.source, job.size, job.f32, job.mipmap, stack);
}

/** the most passes an Iterate Buffer runs: its iteration count is a parameter (and can come from an expression), and
 *  each pass is a full render of the buffer, so a mistyped count could keep the GPU busy for minutes */
export const MAX_ITERATIONS = 1024;

/** the init pass, then the loop pass `iterations` times, each reading the previous result */
export function renderIterateBuffer(host: RenderHost, g: GenIterateBuffer, stack: Set<string>): Resolved {
  const key = g.genName + "_it_tex";
  const { init, loop } = g.jobs();
  const builtInit = buildFragmentShader(init);
  const builtLoop = buildFragmentShader(loop);
  const iterations = Math.max(0, Math.min(MAX_ITERATIONS, Math.floor(Number(g.iterations) || 0)));
  const size = g.size;
  const f32 = !!g.getParameter("f32");
  const mipmap = !!g.getParameter("mipmap");
  const shrink = !!g.getParameter("shrink");
  const initDeps = host.resolveUniforms(builtInit.uniforms, stack);
  // the loop reads its own previous result: resolve the rest of its samplers now, the loop texture each iteration
  const loopDepsSig = host.resolveUniforms(builtLoop.uniforms, stack).sig;
  const timeSig = (builtInit.body + builtLoop.body).includes("elapsed_time") ? "t" + host.time : "";
  if (timeSig) host.usedTime = true;
  const sig = fnv(builtInit.source + builtLoop.source + initDeps.sig + loopDepsSig + [iterations, size, f32, mipmap, shrink].join(",") + timeSig);
  const cached = host.cached(key);
  if (cached && cached.sig === sig) return { target: cached.target, sig };
  let current: Target | null = null;
  try {
    g.currentIteration = 0;
    current = host.createTarget(size, f32, mipmap);
    host.draw(builtInit, initDeps.values, current);
    for (let it = 1; it <= iterations; it++) {
      g.currentIteration = it;
      host.loopTextures.set(g.genName, current);
      const s = shrink ? Math.max(4, size >> it) : size;
      const next = host.createTarget(s, f32, mipmap);
      const deps = host.resolveUniforms(builtLoop.uniforms, stack);
      host.draw(builtLoop, deps.values, next);
      host.deleteTarget(current);
      current = next;
    }
    host.loopTextures.set(g.genName, current);
    host.errors.delete(key);
  } catch (e) {
    if (e instanceof ShaderError) host.errors.set(key, e);
    else throw e;
  }
  g.currentIteration = iterations + 1;
  if (cached) host.deleteTarget(cached.target);
  host.setCached(key, current ? { sig, target: current } : null);
  return { target: current, sig };
}
