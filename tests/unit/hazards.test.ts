/* The order of the render worker's lanes on shared targets (src/engine/render/hazards.ts). */
import { describe, expect, it } from "vitest";
import { Hazards } from "../../src/engine/render/hazards";
import type { Op } from "../../src/engine/render/protocol";

const samplers = (p: string) => (p === "reads" ? [true, false] : []);
const create = (id: number): Op => ({ op: "create", id, size: 4, height: 4, f32: false, mipmap: false });
const draw = (id: number, from = -1): Op => ({ op: "draw", id, program: from >= 0 ? "reads" : "plain", values: from >= 0 ? [from, 1] : [], blend: false, time: 0 });
const present = (id: number): Op => ({ op: "present", id, w: 4, h: 4, checker: false, out: 0 });

describe("Hazards", () => {
  it("a read waits for an earlier batch's write of the same target, nothing else waits", () => {
    const h = new Hazards();
    h.register(1, [create(10), draw(10), present(10)], samplers);
    h.register(2, [create(20), draw(20, 10), present(20)], samplers);
    h.register(3, [create(30), draw(30), present(30)], samplers);
    // batch 2 draws into its own target at once, but its read of 10 waits until batch 1 drew it
    expect(h.before(2, 0)).toBeNull();
    expect(h.before(2, 1)).not.toBeNull();
    expect(h.before(3, 1)).toBeNull();
    h.after(1, 0);
    expect(h.before(2, 1)).not.toBeNull();
    h.after(1, 1);
    // batch 1 still presents 10: a read, which another read does not wait for
    expect(h.before(2, 1)).toBeNull();
  });

  it("a write waits for earlier reads, a failed batch holds nobody up, deletes wait for earlier users", async () => {
    const h = new Hazards();
    h.register(1, [present(10)], samplers);
    h.register(2, [draw(10)], samplers);
    const w = h.before(2, 0);
    expect(w).not.toBeNull();
    let deleted = false;
    h.register(3, [], samplers);
    h.delete(10, 3, () => (deleted = true));
    expect(deleted).toBe(false);
    h.finish(1);
    await w;
    expect(h.before(2, 0)).toBeNull();
    expect(deleted).toBe(false);
    h.after(2, 0);
    expect(deleted).toBe(true);
  });
});
