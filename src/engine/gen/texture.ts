/* Ports of gen_texture.gd, gen_buffer.gd, gen_iterate_buffer.gd, gen_image.gd, gen_text.gd:
 * nodes whose output is a texture the renderer computes (or loads) rather than inline shader code. */
import { GenContext } from "../context";
import { ShaderCode, defaultGeneratedShader, type TextureRef } from "../shader-code";
import { Gen, OutputPort, type Dict, type ParameterDef, type PortDef } from "./base";

/** A sampler a generated shader reads; the renderer finds what to put in it from `gen` and `slot`. */
export class GenTextureRef implements TextureRef {
  readonly kind = "texture" as const;
  constructor(
    public gen: GenTexture,
    public slot: string,
  ) {}
  get key() {
    return this.gen.genName + this.slot;
  }
}

/** the type of what feeds an input, without generating its code */
export function sourceType(g: Gen, input: number): string | undefined {
  const s = g.getSource(input);
  return s ? s.generator.getOutputDefs(true)[s.outputIndex]?.type : undefined;
}

export abstract class GenTexture extends Gen {
  override getOutputDefs(): PortDef[] {
    return [{ type: "rgba" }];
  }
  getAdjustedUv(uv: string): string {
    return uv;
  }
  textureRef(slot = "_tex") {
    return new GenTextureRef(this, slot);
  }
  _getShaderCodeLod(uv: string, _outputIndex: number, context: GenContext, isGreyscale = false, lod = -1, suffix = "_tex"): ShaderCode {
    const g = this.genName;
    const rv = new ShaderCode();
    rv.outputType = isGreyscale ? "f" : "rgba";
    const textureName = g + suffix;
    let variant = context.getVariant(this, uv);
    const type = isGreyscale ? "float" : "vec4";
    const select = isGreyscale ? ".r" : "";
    if (variant === -1) {
      variant = context.getVariant(this, uv);
      rv.addUniform(textureName, "sampler2D", this.textureRef(suffix));
      if (lod < 0) rv.code = `${type} ${g}_${variant} = textureLod(${textureName}, ${this.getAdjustedUv(uv)}, 0.0)${select};\n`;
      else {
        rv.addUniform(`p_${g}_lod`, "float", lod);
        rv.code = `${type} ${g}_${variant} = textureLod(${textureName}, ${this.getAdjustedUv(uv)}, p_${g}_lod)${select};\n`;
      }
    }
    rv.outputValues[rv.outputType] = `${g}_${variant}`;
    return rv;
  }
  override _getShaderCode(uv: string, outputIndex: number, context: GenContext): ShaderCode {
    return this._getShaderCodeLod(uv, outputIndex, context);
  }
}

/** What the renderer must do to fill a buffer's texture */
export interface BufferJob {
  source: ShaderCode;
  size: number;
  f32: boolean;
  mipmap: boolean;
}

export const VERSION_OLD = 0,
  VERSION_SIMPLE = 1,
  VERSION_COMPLEX = 2;

export class GenBuffer extends GenTexture {
  version = VERSION_OLD;
  paused = false;
  constructor() {
    super();
    this.parameters.size = 9;
  }
  override getType() {
    return "buffer";
  }
  override getTypeName() {
    return "Buffer";
  }
  override getDescription() {
    return "Buffer\nSamples input into a texture of a given resolution";
  }
  override getParameterDefs(): ParameterDef[] {
    const defs: ParameterDef[] = [{ name: "size", label: "Size", type: "size", first: 4, last: 13, default: 4 }];
    if (this.version === VERSION_OLD) defs.push({ name: "lod", label: "Lod", type: "float", min: 0, max: 10, step: 0.01, default: 0 });
    else if (this.version === VERSION_COMPLEX) {
      defs.push({ name: "filter", label: "Filter", type: "boolean", default: true });
      defs.push({ name: "mipmap", label: "Mipmap", type: "boolean", default: true });
      defs.push({ name: "f32", label: "32 bits", type: "boolean", default: false });
    }
    return defs;
  }
  override getInputDefs(): PortDef[] {
    return [{ name: "in", type: "rgba" }];
  }
  override getOutputDefs(): PortDef[] {
    return this.version === VERSION_OLD ? [{ type: "rgba" }, { type: "rgba" }] : [{ type: "rgba" }];
  }
  get size() {
    return Math.pow(2, Number(this.getParameter("size") ?? 9));
  }
  isGreyscale() {
    return sourceType(this, 0) === "f";
  }
  job(): BufferJob {
    const src = this.getSource(0);
    const source = src ? src.generator.getShaderCode("uv", src.outputIndex, new GenContext()) : defaultGeneratedShader();
    if (!source.outputType) return { source: defaultGeneratedShader(), size: this.size, f32: false, mipmap: false };
    return {
      source,
      size: this.size,
      f32: this.version === VERSION_COMPLEX && !!this.getParameter("f32"),
      mipmap: this.version !== VERSION_COMPLEX || !!this.getParameter("mipmap"),
    };
  }
  override getAdjustedUv(uv: string): string {
    if (this.version === VERSION_COMPLEX && !this.getParameter("filter")) return `((floor(fract(${uv}) * ${this.genName}_tex_size)+vec2(0.5))/${this.genName}_tex_size)`;
    return `fract(${uv})`;
  }
  override _getShaderCode(uv: string, outputIndex: number, context: GenContext): ShaderCode {
    const lod = outputIndex === 0 ? -1 : Number(this.getParameter("lod") ?? 0);
    const sc = this._getShaderCodeLod(uv, outputIndex, context, this.isGreyscale(), lod);
    sc.addUniform(`${this.genName}_tex_size`, "float", this.size);
    return sc;
  }
  override getOutputAttributes(): Record<string, string> {
    return { texture: `${this.genName}_tex`, texture_size: `${this.genName}_tex_size` };
  }
  override _serialize(data: Dict) {
    data.type = "buffer";
    if (this.version !== VERSION_OLD) data.version = this.version;
    return data;
  }
  override _deserialize(data: Dict) {
    this.version = data.version ?? VERSION_OLD;
  }
}

export class GenIterateBuffer extends GenTexture {
  paused = false;
  constructor() {
    super();
    this.parameters.size = 9;
  }
  override getType() {
    return "iterate_buffer";
  }
  override getTypeName() {
    return "Iterate Buffer";
  }
  override getDescription() {
    return 'Iterate Buffer\nSamples input into a texture and applies a "loop subgraph" repeatedly';
  }
  override getParameterDefs(): ParameterDef[] {
    return [
      { name: "size", label: "Size", type: "size", first: 4, last: 13, default: 4 },
      { name: "shrink", label: "Shrink", type: "boolean", default: false },
      { name: "autostop", label: "Auto stop", type: "boolean", default: false },
      { name: "iterations", label: "Iterations", type: "float", min: 1, max: 50, step: 1, default: 5 },
      { name: "filter", label: "Filter", type: "boolean", default: true },
      { name: "mipmap", label: "Mipmap", type: "boolean", default: true },
      { name: "f32", label: "32 bits", type: "boolean", default: false },
    ];
  }
  override getInputDefs(): PortDef[] {
    return [
      { name: "in", type: "rgba" },
      { name: "loop_in", type: "rgba" },
    ];
  }
  override getOutputDefs(): PortDef[] {
    return [{ type: "rgba" }, { type: "rgba" }];
  }
  currentIteration = 0;
  override followInput(i: number) {
    return i === 1 ? [new OutputPort(this, 0)] : super.followInput(i);
  }
  get size() {
    return Math.pow(2, Number(this.getParameter("size") ?? 9));
  }
  get iterations(): number {
    return Math.max(1, Math.round(this.calculateFloatParameter("iterations") ?? 1));
  }
  isGreyscale() {
    return sourceType(this, 0) === "f" && sourceType(this, 1) === "f";
  }
  jobs(): { init: ShaderCode; loop: ShaderCode } {
    const get = (i: number) => {
      const s = this.getSource(i);
      const sc = s ? s.generator.getShaderCode("uv", s.outputIndex, new GenContext()) : defaultGeneratedShader();
      return sc.outputType ? sc : defaultGeneratedShader();
    };
    return { init: get(0), loop: get(1) };
  }
  override getAdjustedUv(uv: string): string {
    if (!this.getParameter("filter")) return `((floor(fract(${uv}) * ${this.genName}_it_tex_size)+vec2(0.5))/${this.genName}_it_tex_size)`;
    return `fract(${uv})`;
  }
  override _getShaderCode(uv: string, outputIndex: number, context: GenContext): ShaderCode {
    const sc = this._getShaderCodeLod(uv, outputIndex, context, this.isGreyscale(), -1, outputIndex === 0 ? "_it_tex" : "_loop_tex");
    sc.addUniform(`${this.genName}_it_tex_size`, "float", this.size);
    sc.addUniform(`${this.genName}_iteration`, "int", () => this.currentIteration);
    return sc;
  }
  override getOutputAttributes(outputIndex: number): Record<string, string> {
    const g = this.genName;
    return outputIndex === 0 ? { texture: `${g}_it_tex`, texture_size: `${g}_it_tex_size` } : { texture: `${g}_loop_tex`, texture_size: `${g}_it_tex_size`, iteration: `${g}_iteration` };
  }
  override _serialize(data: Dict) {
    data.type = "iterate_buffer";
    return data;
  }
}

/** An image the user picked; its `image` parameter holds a URL (or data: URL) in this port. */
export class GenImage extends GenTexture {
  override getType() {
    return "image";
  }
  override getTypeName() {
    return "Image";
  }
  override getParameterDefs(): ParameterDef[] {
    return [
      { name: "image", type: "image_path", label: "", default: "" },
      { name: "fix_ar", type: "boolean", label: "Fix Aspect Ratio", default: false },
      { name: "clamp", type: "boolean", label: "Clamp", default: false },
      { name: "filter", type: "boolean", label: "Filter", default: true },
    ];
  }
  /** set by the renderer once the image is loaded */
  imageSize = { w: 0, h: 0 };
  override getAdjustedUv(uv: string): string {
    if (this.getParameter("fix_ar") && this.imageSize.w && this.imageSize.h) {
      const ar = this.imageSize.h / this.imageSize.w;
      uv = `((${uv}) - vec2(0.0, ${((1 - ar) / 2).toFixed(6)})) * vec2(1.0, ${(1 / ar).toFixed(6)})`;
    }
    uv = this.getParameter("clamp") ? `clamp(${uv}, 0.0, 1.0)` : `mod(${uv}, 1.0)`;
    if (!this.getParameter("filter") && this.imageSize.w) {
      const ts = `vec2(${this.imageSize.w.toFixed(1)}, ${this.imageSize.h.toFixed(1)})`;
      uv = `(floor(fract(${uv}) * ${ts})+vec2(0.5))/${ts}`;
    }
    return uv;
  }
}

/** Text drawn into a texture (by the renderer, with the browser's fonts) */
export class GenText extends GenTexture {
  override getType() {
    return "text";
  }
  override getTypeName() {
    return "Text";
  }
  override getDescription() {
    return "Text\nText as an image";
  }
  override getParameterDefs(): ParameterDef[] {
    return [
      { name: "text", label: "Text", type: "string", default: "Text" },
      { name: "font", label: "Font", type: "string", default: "" },
      { name: "fg", label: "Foreground", type: "color", default: { r: 1, g: 1, b: 1, a: 1 } },
      { name: "bg", label: "Background", type: "color", default: { r: 0, g: 0, b: 0, a: 1 } },
      { name: "font_size", label: "Font size", type: "float", min: 0, max: 128, step: 1, default: 32 },
      { name: "line_spacing", label: "Line Spacing", type: "float", min: -512, max: 512, step: 1, default: 0 },
      {
        name: "alignment",
        label: "Align",
        default: 0,
        type: "enum",
        values: [
          { name: "Left", value: "0" },
          { name: "Center", value: "1" },
          { name: "Right", value: "2" },
        ],
      },
      { name: "center", label: "Center", type: "boolean", default: false },
      { name: "x", label: "X", type: "float", min: -0.5, max: 0.5, step: 0.001, default: 0.1, control: "P1.x" },
      { name: "y", label: "Y", type: "float", min: -0.5, max: 0.5, step: 0.001, default: 0.1, control: "P1.y" },
    ];
  }
}
