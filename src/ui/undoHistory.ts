/* The undo history of a project: the current state as text, the states before and after it deflated (fflate),
 * kept under a number of steps and a number of bytes, the oldest forgotten first. */
import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";

export interface UndoLimits {
  /** most steps kept back */
  steps: number;
  /** most bytes the deflated states (undo and redo) may take together */
  bytes: number;
}

export const DEFAULT_LIMITS: UndoLimits = { steps: 100, bytes: 32 * 1024 * 1024 };

const pack = (s: string) => deflateSync(strToU8(s), { level: 6 });
const unpack = (b: Uint8Array) => strFromU8(inflateSync(b));

export class UndoHistory {
  private past: Uint8Array[] = [];
  private future: Uint8Array[] = [];
  private size = 0;
  /** the current state; null until the first one is known */
  current: string | null;

  constructor(
    current: string | null = null,
    private limits: UndoLimits = DEFAULT_LIMITS,
  ) {
    this.current = current;
  }

  /** records a new current state, the old one becoming a step back; false when nothing changed */
  record(state: string): boolean {
    if (state === this.current) return false;
    if (this.current !== null) this.pushPast(pack(this.current));
    this.clearFuture();
    this.current = state;
    this.trim();
    return true;
  }

  /** the state one step back, which becomes the current one */
  undo(): string | undefined {
    const b = this.past.pop();
    if (!b) return undefined;
    this.size -= b.length;
    if (this.current !== null) this.pushFuture(pack(this.current));
    this.current = unpack(b);
    this.trim();
    return this.current;
  }

  /** the state one step forward, which becomes the current one */
  redo(): string | undefined {
    const b = this.future.pop();
    if (!b) return undefined;
    this.size -= b.length;
    if (this.current !== null) this.pushPast(pack(this.current));
    this.current = unpack(b);
    this.trim();
    return this.current;
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  /** steps back and forward */
  get depth() {
    return { undo: this.past.length, redo: this.future.length };
  }
  /** bytes taken by the deflated states */
  get bytes() {
    return this.size;
  }

  private pushPast(b: Uint8Array) {
    this.past.push(b);
    this.size += b.length;
  }
  private pushFuture(b: Uint8Array) {
    this.future.push(b);
    this.size += b.length;
  }
  private clearFuture() {
    for (const b of this.future) this.size -= b.length;
    this.future = [];
  }
  /** forgets the oldest steps back, then the furthest steps forward, until under the limits */
  private trim() {
    while (this.past.length > this.limits.steps) this.size -= this.past.shift()!.length;
    while (this.size > this.limits.bytes && this.past.length) this.size -= this.past.shift()!.length;
    while (this.size > this.limits.bytes && this.future.length) this.size -= this.future.shift()!.length;
  }
}
