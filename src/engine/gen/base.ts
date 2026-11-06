/* Port of MMGenBase (addons/material_maker/engine/nodes/gen_base.gd): the base of every node. */
import { GenContext } from "../context";
import { registry } from "../registry";
import { ShaderCode } from "../shader-code";
import { evaluateExpression } from "../expression";
import { cloneValue, deserializeValue, serializeValue, type ParamValue } from "../params/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Dict = Record<string, any>;

export interface ParameterDef {
  name: string;
  type: string;
  label?: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  first?: number;
  last?: number;
  values?: { name: string; value: string }[];
  shortdesc?: string;
  longdesc?: string;
  control?: string;
  widget_type?: string;
  [k: string]: unknown;
}
export interface PortDef {
  name?: string;
  type: string;
  label?: string;
  default?: string;
  function?: boolean;
  shortdesc?: string;
  longdesc?: string;
  group_size?: number;
  [k: string]: unknown;
}

export class InputPort {
  constructor(
    public generator: Gen,
    public inputIndex: number,
  ) {}
  toStr() {
    return `${this.generator.name}.in(${this.inputIndex})`;
  }
}
export class OutputPort {
  constructor(
    public generator: Gen,
    public outputIndex: number,
  ) {}
  toStr() {
    return `${this.generator.name}.out(${this.outputIndex})`;
  }
}

/** What a graph offers its children (implemented by GenGraph) */
export interface GenParent {
  getPortSource(genName: string, inputIndex: number): OutputPort | null;
  getPortTargets(genName: string, outputIndex: number): InputPort[];
  getNamedParameters(): Record<string, { id: string; value: number }>;
  transmitsSeed: boolean;
  getSeed(): number;
  notifyChanged(what?: Gen): void;
  isGraph: true;
}

export const MAX_SEED = 4294967296;
let nextInstanceId = 1;

/** Late bound so graph code can create generators without an import cycle */
export const factory = {
  createGen: null as unknown as (data: Dict) => Gen | null,
};

export class Gen {
  /** stands in for Godot's get_instance_id(): it names the generated GLSL symbols (o<id>_...) */
  readonly id = nextInstanceId++;
  name = "";
  parent: (Gen & GenParent) | null = null;
  position = { x: 0, y: 0 };
  /** the library node it was made from, when it was */
  model: string | null = null;
  parameters: Record<string, ParamValue> = {};
  seedLocked = false;
  seedValue = 0;
  preview = -1;
  minimized = false;
  /** free data the editor keeps with a node (size, color, ...) */
  extra: Dict = {};

  get genName() {
    return "o" + this.id;
  }

  getHierName(): string {
    if (!this.parent) return "";
    let rv = this.name;
    let node: Gen = this.parent;
    while (node.parent) {
      rv = node.name + "/" + rv;
      node = node.parent;
    }
    return rv;
  }

  /* ----- what kind of node ----- */
  getType(): string {
    return "generic";
  }
  getTypeName(): string {
    return "Unnamed";
  }
  getDescription(): string {
    return "";
  }
  acceptFloatExpressions(): boolean {
    return true;
  }
  canBeDeleted(): boolean {
    return true;
  }
  isTemplate(): boolean {
    return this.model !== null;
  }
  isEditable(): boolean {
    return false;
  }
  toggleEditable(): boolean {
    return false;
  }

  /* ----- seed ----- */
  hasRandomness(): boolean {
    return false;
  }
  getSeed(): number {
    let s = this.seedValue;
    if (!this.seedLocked && this.parent?.transmitsSeed) s += this.parent.getSeed();
    return s;
  }
  setSeed(s: number): boolean {
    if (!this.hasRandomness() || this.seedLocked) return false;
    this.seedValue = s;
    this.changed();
    return true;
  }
  static seedFromPosition(p: { x: number; y: number }): number {
    // ((int(p.x) * 0x1f1f1f1f) ^ int(p.y)) % 65536 with 64 bit ints
    const x = BigInt(Math.trunc(p.x)) * 0x1f1f1f1fn;
    const v = (x ^ BigInt(Math.trunc(p.y))) % 65536n;
    return Number(v);
  }

  /* ----- parameters ----- */
  getParameterDefs(): ParameterDef[] {
    return [];
  }
  getParameterDef(name: string): ParameterDef | undefined {
    return this.getParameterDefs().find((p) => p.name === name);
  }
  initParameters(): void {
    for (const p of this.getParameterDefs()) {
      if (!(p.name in this.parameters) && p.default !== undefined) {
        // Note: Material Maker subtracts `first` from a size's default here; files store sizes as exponents, as does this port.
        this.parameters[p.name] = cloneValue(deserializeValue(p.default));
      }
    }
  }
  getParameter(name: string): ParamValue {
    if (name in this.parameters) return this.parameters[name];
    const d = this.getParameterDef(name);
    return d ? deserializeValue(d.default) : undefined;
  }
  setParameter(name: string, v: ParamValue): void {
    this.parameters[name] = v;
    this.changed();
  }
  /** Godot's calculate_float_parameter: a float or an expression over the graph's named parameters */
  calculateFloatParameter(name: string): number | undefined {
    const v = this.getParameter(name);
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const vars: Record<string, number> = {};
      for (const [k, np] of Object.entries(this.parent?.getNamedParameters() ?? {})) vars[k] = np.value;
      return evaluateExpression(v, vars);
    }
    return undefined;
  }

  /** the graph has changed under this node */
  changed(): void {
    this.parent?.notifyChanged(this);
  }

  /* ----- ports ----- */
  getInputDefs(): PortDef[] {
    return [];
  }
  getOutputDefs(_showHidden = false): PortDef[] {
    return [];
  }
  getSource(inputIndex: number): OutputPort | null {
    return this.parent ? this.parent.getPortSource(this.name, inputIndex) : null;
  }
  getTargets(outputIndex: number): InputPort[] {
    return this.parent ? this.parent.getPortTargets(this.name, outputIndex) : [];
  }
  /** the outputs that depend on an input */
  followInput(_inputIndex: number): OutputPort[] {
    return this.getOutputDefs().map((_, i) => new OutputPort(this, i));
  }
  /** called when the generic port count or the model changes, so connections that no longer fit are dropped */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getOutputAttributes(_outputIndex: number): Record<string, string> {
    return {};
  }

  /* ----- shader generation ----- */
  getShaderCode(uv: string, outputIndex: number, context: GenContext): ShaderCode {
    const rv = this._getShaderCode(uv, outputIndex, context);
    const t = registry.ioTypes[rv.outputType];
    if (t) {
      for (const c of t.convert ?? []) {
        if (!(c.type in rv.outputValues)) rv.outputValues[c.type] = c.expr.replaceAll("$(value)", rv.outputValues[rv.outputType]);
      }
    }
    return rv;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _getShaderCode(_uv: string, _outputIndex: number, _context: GenContext): ShaderCode {
    return new ShaderCode();
  }

  /* ----- files ----- */
  serialize(): Dict {
    let rv: Dict = { name: this.name, type: this.getType(), parameters: {}, node_position: { x: this.position.x, y: this.position.y } };
    for (const p of this.getParameterDefs()) {
      if (p.name in this.parameters) rv.parameters[p.name] = serializeValue(this.parameters[p.name]);
      else if (p.default !== undefined) rv.parameters[p.name] = p.default;
    }
    if (this.seedValue >= 0 && this.seedValue <= 1) rv.seed_int = Math.round(this.seedValue * MAX_SEED);
    else rv.seed = this.seedValue;
    if (this.seedLocked) rv.seed_locked = true;
    if (this.preview >= 0) rv.preview = this.preview;
    if (this.minimized) rv.minimized = true;
    if (Object.keys(this.extra).length) rv.editor = structuredClone(this.extra);
    if (this.model !== null) rv.type = this.model;
    else rv = this._serialize(rv);
    return this._serializeData(rv);
  }
  _serialize(data: Dict): Dict {
    return data;
  }
  _serializeData(data: Dict): Dict {
    return data;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _deserialize(_data: Dict): void {}
  deserialize(data: Dict): void {
    this._deserialize(data);
    if (data.name !== undefined) this.name = data.name;
    if (data.node_position) this.position = { x: data.node_position.x, y: data.node_position.y };
    if (data.parameters) {
      for (const k of Object.keys(data.parameters)) this.setParameterSilently(k, deserializeValue(data.parameters[k]));
    } else {
      for (const p of this.getParameterDefs()) if (p.name in data && p.name !== "type") this.setParameterSilently(p.name, deserializeValue(data[p.name]));
    }
    this.seedLocked = data.seed_locked === true;
    if (data.seed_int !== undefined) this.seedValue = data.seed_int / MAX_SEED;
    else if (data.seed !== undefined) this.seedValue = data.seed;
    else if (data.seed_value !== undefined) {
      this.seedLocked = true;
      this.seedValue = data.seed_value;
    } else {
      this.seedLocked = false;
      this.seedValue = Gen.seedFromPosition(this.position);
    }
    this.preview = data.preview ?? -1;
    this.minimized = !!data.minimized;
    if (data.editor) this.extra = structuredClone(data.editor);
    this.postLoad();
  }
  /** set while loading: no change notification, but the side effects a parameter has on the node */
  setParameterSilently(name: string, v: ParamValue): void {
    const p = this.parent;
    this.parent = null;
    try {
      this.setParameter(name, v);
    } finally {
      this.parent = p;
    }
  }
  postLoad(): void {}
}

/** MMGenBase.get_default_generated_shader */
export { defaultGeneratedShader } from "../shader-code";
