/* The order of the render worker's lanes where they touch the same targets.
 *
 * The page records every render with one Recorder, whose cache of Buffer results all lanes share: a node thumbnail
 * ("fg") may read a Buffer that a batch of the big views ("view") or of an export ("bg") draws. The lanes run side
 * by side, so the worker makes each operation wait for the operations of earlier batches (lower ids: sent before)
 * on the same targets that it must come after: a read waits for earlier writes, a write for earlier reads and
 * writes. Reads of different lanes do not wait for each other, nor does anything that touches other targets.
 * Batches only ever wait for earlier ones, so the earliest unfinished batch can always go on: nothing deadlocks.
 * A target deleted while an earlier batch still uses it is deleted once that batch is done with it. */
import type { Op } from "./protocol";

/** the targets an operation reads and writes */
export function accessesOf(o: Op, samplers: (program: string) => boolean[] | undefined): { reads: number[]; writes: number[] } {
  switch (o.op) {
    case "create":
    case "upload":
      return { reads: [], writes: [o.id] };
    case "draw": {
      const s = samplers(o.program);
      const reads: number[] = [];
      if (s) o.values.forEach((v, i) => s[i] && typeof v === "number" && v >= 0 && v !== o.id && !reads.includes(v) && reads.push(v));
      return { reads, writes: [o.id] };
    }
    case "present":
    case "read":
      return { reads: [o.id], writes: [] };
    default:
      return { reads: [], writes: [] };
  }
}

type Access = { batch: number; reads: number; writes: number };

export class Hazards {
  /** what each batch still has to do on each target, by target, oldest batch first */
  private byTarget = new Map<number, Access[]>();
  private byBatch = new Map<number, { ops: { reads: number[]; writes: number[] }[]; access: Map<number, Access> }>();
  private deferred: { id: number; batch: number; run: () => void }[] = [];
  private waiters: (() => void)[] = [];

  /** a batch as it arrives: batches arrive in the order of their ids */
  register(batch: number, ops: Op[], samplers: (program: string) => boolean[] | undefined): void {
    const access = new Map<number, Access>();
    const list = ops.map((o) => {
      const a = accessesOf(o, samplers);
      const get = (id: number) => {
        let x = access.get(id);
        if (!x) {
          x = { batch, reads: 0, writes: 0 };
          access.set(id, x);
          let l = this.byTarget.get(id);
          if (!l) this.byTarget.set(id, (l = []));
          l.push(x);
        }
        return x;
      };
      for (const id of a.reads) get(id).reads++;
      for (const id of a.writes) get(id).writes++;
      return a;
    });
    this.byBatch.set(batch, { ops: list, access });
  }

  private blocked(batch: number, op: number): boolean {
    const b = this.byBatch.get(batch);
    if (!b) return false;
    const { reads, writes } = b.ops[op];
    const earlier = (id: number, write: boolean) => {
      for (const a of this.byTarget.get(id) ?? []) {
        if (a.batch >= batch) break;
        if (a.writes || (write && a.reads)) return true;
      }
      return false;
    };
    return reads.some((id) => earlier(id, false)) || writes.some((id) => earlier(id, true));
  }

  /** resolves when operation `op` of `batch` may run (at once, most of the time) */
  before(batch: number, op: number): Promise<void> | null {
    if (!this.blocked(batch, op)) return null;
    return (async () => {
      while (this.blocked(batch, op)) await new Promise<void>((r) => this.waiters.push(r));
    })();
  }

  /** operation `op` of `batch` is done */
  after(batch: number, op: number): void {
    const b = this.byBatch.get(batch);
    if (!b) return;
    const { reads, writes } = b.ops[op];
    let freed = false;
    for (const id of reads) freed = this.release(b.access, id, "reads") || freed;
    for (const id of writes) freed = this.release(b.access, id, "writes") || freed;
    if (freed) this.wake();
  }

  private release(access: Map<number, Access>, id: number, kind: "reads" | "writes"): boolean {
    const a = access.get(id);
    if (!a) return false;
    a[kind]--;
    if (a.reads || a.writes) return false;
    access.delete(id);
    this.drop(id, a);
    return true;
  }

  private drop(id: number, a: Access) {
    const l = this.byTarget.get(id);
    if (!l) return;
    const i = l.indexOf(a);
    if (i >= 0) l.splice(i, 1);
    if (!l.length) this.byTarget.delete(id);
  }

  /** the batch ended (done or failed): what it did not get to no longer holds anyone up */
  finish(batch: number): void {
    const b = this.byBatch.get(batch);
    if (!b) return;
    this.byBatch.delete(batch);
    for (const [id, a] of b.access) this.drop(id, a);
    this.wake();
  }

  /** deletes a target now, or once the batches before `batch` are done with it */
  delete(id: number, batch: number, run: () => void): void {
    if ((this.byTarget.get(id) ?? []).some((a) => a.batch < batch)) this.deferred.push({ id, batch, run });
    else run();
  }

  /** forgets everything (a lost context) */
  clear(): void {
    this.byTarget.clear();
    this.byBatch.clear();
    this.deferred = [];
    this.wake();
  }

  private wake() {
    if (this.deferred.length)
      this.deferred = this.deferred.filter((d) => {
        if ((this.byTarget.get(d.id) ?? []).some((a) => a.batch < d.batch)) return true;
        d.run();
        return false;
      });
    for (const w of this.waiters.splice(0)) w();
  }
}
