import type { Gen } from "./gen/base";

/** Port of MMGenContext: remembers which (generator, uv) variants were already emitted in the shader being built. */
export class GenContext {
  variants = new Map<Gen, string[]>();
  constructor(public parent: GenContext | null = null) {}

  hasVariant(g: Gen): boolean {
    return this.variants.has(g) || (this.parent !== null && this.parent.hasVariant(g));
  }
  touchVariant(g: Gen): void {
    if (!this.variants.has(g)) this.variants.set(g, []);
    this.parent?.touchVariant(g);
  }
  /** index of the variant if it was already emitted, -1 (and records it) otherwise */
  getVariant(g: Gen, variant: string): number {
    let rv = -1;
    const list = this.variants.get(g);
    if (list) {
      rv = list.indexOf(variant);
      if (rv === -1) list.push(variant);
    } else this.variants.set(g, [variant]);
    this.touchVariant(g);
    return rv;
  }
}
