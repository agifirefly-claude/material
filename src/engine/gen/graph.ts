/* Ports of gen_graph.gd, gen_ios.gd, gen_remote.gd, gen_switch.gd, gen_reroute.gd, gen_portal.gd, gen_comment*.gd */
import { GenContext } from "../context";
import { registry } from "../registry";
import { defaultGeneratedShader, ShaderCode } from "../shader-code";
import { cloneValue, deserializeValue, serializeValue, type ParamValue } from "../params/types";
import { factory, Gen, InputPort, OutputPort, type Dict, type GenParent, type ParameterDef, type PortDef } from "./base";

export interface Connection {
  from: string;
  from_port: number;
  to: string;
  to_port: number;
}

type Listener = (what?: Gen) => void;

export class GenGraph extends Gen implements GenParent {
  readonly isGraph = true as const;
  label = "Graph";
  shortdesc = "";
  longdesc = "";
  connections: Connection[] = [];
  children: Gen[] = [];
  editable = false;
  transmitsSeed = true;
  scrollOffset: { x: number; y: number } | null = null;
  private listeners = new Set<Listener>();
  /** bumped on every change anywhere below this graph */
  version = 0;

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  notifyChanged(what?: Gen): void {
    this.version++;
    for (const l of this.listeners) l(what);
    this.parent?.notifyChanged(what ?? this);
  }

  getNode(name: string): Gen | undefined {
    return this.children.find((c) => c.name === name);
  }
  get genInputs() {
    return this.getNode("gen_inputs") as GenIOs | undefined;
  }
  get genOutputs() {
    return this.getNode("gen_outputs") as GenIOs | undefined;
  }
  get genParameters() {
    return this.getNode("gen_parameters") as GenRemote | undefined;
  }

  override getType() {
    return "graph";
  }
  override getTypeName() {
    return this.label;
  }
  override getDescription() {
    return [this.shortdesc, this.longdesc].filter(Boolean).join("\n");
  }
  override toggleEditable() {
    this.editable = !this.editable;
    if (this.editable) this.model = null;
    return true;
  }
  override isEditable() {
    return this.editable;
  }
  override hasRandomness() {
    return this.transmitsSeed && this.children.some((c) => c.hasRandomness() && !c.seedLocked);
  }
  override setSeed(s: number) {
    if (super.setSeed(s) && this.transmitsSeed) return true;
    return false;
  }

  override getParameterDefs(): ParameterDef[] {
    return this.genParameters?.getParameterDefs() ?? [];
  }
  override setParameter(n: string, v: ParamValue): void {
    this.parameters[n] = v;
    this.genParameters?.setParameter(n, v);
    this.changed();
  }
  override getInputDefs(): PortDef[] {
    return this.genInputs?.getOutputDefs() ?? [];
  }
  override getOutputDefs(): PortDef[] {
    return this.genOutputs?.getInputDefs() ?? [];
  }

  followConnectionsFindMatching(start: InputPort | OutputPort, match: Gen): (InputPort | OutputPort)[] {
    const list: (InputPort | OutputPort)[] = [start];
    const visited = new Set<string>();
    const rv: (InputPort | OutputPort)[] = [];
    while (list.length) {
      const port = list.pop()!;
      const key = `${port.generator.id}:${port instanceof InputPort ? "i" : "o"}${port instanceof InputPort ? port.inputIndex : port.outputIndex}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (port !== start && port.generator === match) rv.push(port);
      if (port instanceof InputPort) list.push(...port.generator.followInput(port.inputIndex));
      else if (port.generator.parent) list.push(...port.generator.parent.getPortTargets(port.generator.name, port.outputIndex));
    }
    return rv;
  }

  override followInput(inputIndex: number): OutputPort[] {
    const ins = this.genInputs,
      outs = this.genOutputs;
    if (!ins || !outs) return [];
    return this.followConnectionsFindMatching(new OutputPort(ins, inputIndex), outs).map((p) => new OutputPort(this, (p as InputPort).inputIndex));
  }

  getPortSource(genName: string, inputIndex: number): OutputPort | null {
    let rv: OutputPort | null = null;
    if (genName === "gen_inputs") {
      if (this.parent) rv = this.parent.getPortSource(this.name, inputIndex);
    } else {
      for (const c of this.connections) {
        if (c.to === genName && c.to_port === inputIndex) {
          const src = this.getNode(c.from);
          if (src) rv = src instanceof GenGraph ? src.getPortSource("gen_outputs", c.from_port) : new OutputPort(src, c.from_port);
        }
      }
    }
    if (rv && rv.generator.name === "gen_inputs" && rv.generator.parent) rv = (rv.generator.parent as GenGraph).getPortSource("gen_inputs", rv.outputIndex);
    return rv;
  }

  getPortTargets(genName: string, outputIndex: number): InputPort[] {
    const rv: InputPort[] = [];
    for (const c of this.connections) {
      if (c.from === genName && c.from_port === outputIndex) {
        const t = this.getNode(c.to);
        if (t) rv.push(new InputPort(t, c.to_port));
      }
    }
    return rv;
  }

  uniqueName(name: string): string {
    if (!this.getNode(name)) return name;
    const m = /^(.*_)\d+$/.exec(name);
    const prefix = m ? m[1] : name + "_";
    let i = 1;
    while (this.getNode(name)) {
      i++;
      name = prefix + i;
    }
    return name;
  }

  addGenerator(g: Gen): boolean {
    let name = g.name;
    if (name === "Material" || name === "Brush") {
      if (this.getNode(name)) return false;
      if (this.parent) return false;
    } else if (name === "") name = g.getType() + "_1";
    g.name = this.uniqueName(name);
    g.parent = this;
    this.children.push(g);
    this.notifyChanged(g);
    return true;
  }

  removeGenerator(g: Gen): boolean {
    if (!g.canBeDeleted()) return false;
    this.connections = this.connections.filter((c) => c.from !== g.name && c.to !== g.name);
    this.children = this.children.filter((c) => c !== g);
    g.parent = null;
    this.fixRemotes();
    this.notifyChanged();
    return true;
  }

  replaceGenerator(old: Gen, g: Gen): void {
    g.name = old.name;
    g.position = old.position;
    const i = this.children.indexOf(old);
    old.parent = null;
    g.parent = this;
    this.children[i] = g;
    this.notifyChanged(g);
  }

  renameGenerator(g: Gen, newName: string): boolean {
    if (newName === g.name) return true;
    if (!/^[\w.-]+$/.test(newName) || this.getNode(newName)) return false;
    for (const c of this.connections) {
      if (c.from === g.name) c.from = newName;
      if (c.to === g.name) c.to = newName;
    }
    for (const r of this.children) if (r instanceof GenRemote) for (const w of r.widgets) for (const l of w.linked_widgets ?? []) if (l.node === g.name) l.node = newName;
    for (const r of this.children) if (r instanceof GenRemote) for (const w of r.widgets) for (const cfg of Object.values(w.configurations ?? {}) as Dict[][]) for (const l of cfg) if (l.node === g.name) l.node = newName;
    g.name = newName;
    this.notifyChanged(g);
    return true;
  }

  portType(g: Gen, port: number, output: boolean): string | undefined {
    return (output ? g.getOutputDefs() : g.getInputDefs())[port]?.type;
  }
  static compatible(outType: string | undefined, inType: string | undefined): boolean {
    if (!outType || !inType) return false;
    const o = registry.ioTypes[outType],
      i = registry.ioTypes[inType];
    if (!o || !i) return false;
    return o.slot_type === i.slot_type || o.slot_type === 42 || i.slot_type === 42;
  }

  connectChildren(from: Gen, fromPort: number, to: Gen, toPort: number): boolean {
    for (const port of this.followConnectionsFindMatching(new InputPort(to, toPort), from)) {
      if (port instanceof OutputPort && port.outputIndex === fromPort) return false; // would loop
    }
    if (from === to) return false;
    this.connections = this.connections.filter((c) => !(c.to === to.name && c.to_port === toPort));
    this.connections.push({ from: from.name, from_port: fromPort, to: to.name, to_port: toPort });
    this.notifyChanged(to);
    return true;
  }

  disconnectChildren(fromName: string, fromPort: number, toName: string, toPort: number): void {
    this.connections = this.connections.filter((c) => !(c.from === fromName && c.from_port === fromPort && c.to === toName && c.to_port === toPort));
    this.notifyChanged();
  }

  reconnectInputs(g: Gen, reconnects: Record<number, number>): void {
    this.connections = this.connections.flatMap((c) => {
      if (c.to === g.name && c.to_port in reconnects) {
        if (reconnects[c.to_port] < 0) return [];
        return [{ ...c, to_port: reconnects[c.to_port] }];
      }
      return [c];
    });
  }
  reconnectOutputs(g: Gen, reconnects: Record<number, number>): void {
    this.connections = this.connections.flatMap((c) => {
      if (c.from === g.name && c.from_port in reconnects) {
        if (reconnects[c.from_port] < 0) return [];
        return [{ ...c, from_port: reconnects[c.from_port] }];
      }
      return [c];
    });
  }

  /** drops connections that no longer fit a node's ports */
  checkInputConnects(node: Gen): void {
    this.connections = this.connections.filter((c) => {
      if (c.to !== node.name) return true;
      const inputs = node.getInputDefs();
      if (c.to_port >= inputs.length) return false;
      const src = this.getNode(c.from);
      if (!src) return false;
      return GenGraph.compatible(src.getOutputDefs()[c.from_port]?.type, inputs[c.to_port].type);
    });
  }

  getNamedParameters(): Record<string, { id: string; value: number }> {
    const rv: Record<string, { id: string; value: number }> = {};
    for (const c of this.children) {
      if (c instanceof GenRemote) {
        for (const [k, id] of Object.entries(c.getNamedParameters())) {
          const v = c.getParameter(k);
          rv[k] = { id, value: typeof v === "number" ? v : 0 };
        }
      }
    }
    return rv;
  }

  fixRemotes(): void {
    for (const c of this.children) if (c instanceof GenRemote) c.fix();
  }
  override postLoad(): void {
    this.fixRemotes();
  }

  override _getShaderCode(uv: string, outputIndex: number, context: GenContext): ShaderCode {
    const outs = this.genOutputs;
    return outs ? outs._getShaderCode(uv, outputIndex, context) : new ShaderCode();
  }

  /** groups generators into a new subgraph (create_subgraph) */
  createSubgraph(gens: Gen[]): GenGraph | null {
    const generators = gens.filter((g) => !["Material", "Brush", "gen_inputs", "gen_outputs"].includes(g.name) && g.parent === this);
    if (!generators.length) return null;
    let cx = 0,
      cy = 0,
      left = Infinity,
      right = -Infinity,
      top = Infinity;
    for (const g of generators) {
      cx += g.position.x;
      cy += g.position.y;
      left = Math.min(left, g.position.x);
      right = Math.max(right, g.position.x);
      top = Math.min(top, g.position.y);
    }
    cx /= generators.length;
    cy /= generators.length;
    const ng = new GenGraph();
    ng.name = "graph";
    this.addGenerator(ng);
    ng.position = { x: cx, y: cy };
    const names = generators.map((g) => g.name);
    for (const g of generators) {
      this.children = this.children.filter((c) => c !== g);
      ng.children.push(g);
      g.parent = ng;
    }
    const ins = new GenIOs();
    ins.name = "gen_inputs";
    ins.position = { x: left - 500, y: cy };
    ng.addGenerator(ins);
    const outs = new GenIOs();
    outs.name = "gen_outputs";
    outs.position = { x: right + 300, y: cy };
    ng.addGenerator(outs);
    const inner: Connection[] = [],
      mine: Connection[] = [],
      inputs: string[] = [],
      outputs: string[] = [];
    for (const c of this.connections) {
      const src = c.from + "." + c.from_port;
      const fromIn = names.includes(c.from),
        toIn = names.includes(c.to);
      if (fromIn && toIn) inner.push(c);
      else if (fromIn) {
        let pi = outputs.indexOf(src);
        if (pi === -1) {
          pi = outputs.length;
          outputs.push(src);
          outs.ports.push({ name: "port" + pi, type: ng.getNode(c.from)!.getOutputDefs()[c.from_port].type });
        }
        mine.push({ from: ng.name, from_port: pi, to: c.to, to_port: c.to_port });
        inner.push({ from: c.from, from_port: c.from_port, to: "gen_outputs", to_port: pi });
      } else if (toIn) {
        let pi = inputs.indexOf(src);
        if (pi === -1) {
          pi = inputs.length;
          inputs.push(src);
          ins.ports.push({ name: "port" + pi, type: this.getNode(c.from)!.getOutputDefs()[c.from_port].type });
        }
        mine.push({ from: c.from, from_port: c.from_port, to: ng.name, to_port: pi });
        inner.push({ from: "gen_inputs", from_port: pi, to: c.to, to_port: c.to_port });
      } else mine.push(c);
    }
    this.connections = mine;
    ng.connections = inner;
    const remote = generators.find((g) => g instanceof GenRemote) as GenRemote | undefined;
    if (remote) {
      remote.name = "gen_parameters";
      ng.parameters = structuredClone(remote.parameters);
    } else {
      const gp = new GenRemote();
      gp.name = "gen_parameters";
      gp.position = { x: cx - 200, y: top - 300 };
      ng.addGenerator(gp);
    }
    this.fixRemotes();
    ng.fixRemotes();
    this.notifyChanged();
    return ng;
  }

  override _serialize(data: Dict): Dict {
    data.label = this.label;
    data.shortdesc = this.shortdesc;
    data.longdesc = this.longdesc;
    data.nodes = this.children.map((c) => c.serialize());
    data.connections = this.connections.map((c) => ({ ...c }));
    if (this.scrollOffset) data.scroll_offset = { ...this.scrollOffset };
    return data;
  }

  override _deserialize(data: Dict): void {
    if (data.label !== undefined) this.label = data.label;
    if (data.shortdesc !== undefined) this.shortdesc = data.shortdesc;
    if (data.longdesc !== undefined) this.longdesc = data.longdesc;
    if (data.scroll_offset) this.scrollOffset = { x: data.scroll_offset.x, y: data.scroll_offset.y };
    let connections: Connection[] = [];
    if (Array.isArray(data.connections)) connections = data.connections;
    else if (data.connections && typeof data.connections === "object") {
      for (const [n, ports] of Object.entries(data.connections as Record<string, Record<string, { node: string; port: number }>>))
        for (const [p, from] of Object.entries(ports)) connections.push({ from: from.node, from_port: from.port, to: n, to_port: parseInt(p) });
    }
    this.addToGraph(data.nodes ?? [], connections);
  }

  /** MMLoader.add_to_gen_graph: creates the nodes, then connects them by their (possibly renamed) names */
  addToGraph(nodes: Dict[], connections: Connection[], offset = { x: 0, y: 0 }): { generators: Gen[]; connections: Connection[] } {
    const rv = { generators: [] as Gen[], connections: [] as Connection[] };
    const names: Record<string, string> = {};
    for (const n of nodes) {
      const g = factory.createGen(n);
      if (!g) {
        console.warn("Cannot create node", n.type, n.name);
        continue;
      }
      const orig = g.name;
      if (this.addGenerator(g)) {
        g.position = { x: g.position.x + offset.x, y: g.position.y + offset.y };
        rv.generators.push(g);
        names[orig] = g.name;
      }
    }
    for (const c0 of connections) {
      const c = { ...c0, from: names[c0.from] ?? c0.from, to: names[c0.to] ?? c0.to, from_port: Math.round(c0.from_port), to_port: Math.round(c0.to_port) };
      const from = this.getNode(c.from),
        to = this.getNode(c.to);
      if (from && to && this.connectChildren(from, c.from_port, to, c.to_port)) rv.connections.push(c);
    }
    // what Godot does when the remotes enter the tree, once all their siblings exist
    for (const g of rv.generators) {
      if (g instanceof GenRemote) {
        g.fix();
        g.applyAll();
      }
    }
    return rv;
  }
}

/* ---------- graph interfaces ---------- */
export class GenIOs extends Gen {
  ports: PortDef[] = [];
  override canBeDeleted() {
    return this.name !== "gen_inputs" && this.name !== "gen_outputs";
  }
  override getType() {
    return "ios";
  }
  override getTypeName() {
    return this.name === "gen_inputs" ? "Inputs" : this.name === "gen_outputs" ? "Outputs" : "IOs";
  }
  ioDefs(): PortDef[] {
    return this.ports.map((p) => {
      const port: PortDef = { name: p.name, type: p.type };
      if (p.shortdesc) port.shortdesc = p.shortdesc;
      if (p.longdesc) port.longdesc = p.longdesc;
      if (p.group_size && p.group_size > 1) port.group_size = p.group_size;
      return port;
    });
  }
  override getInputDefs() {
    return this.name === "gen_inputs" ? [] : this.ioDefs();
  }
  override getOutputDefs() {
    return this.name === "gen_outputs" ? [] : this.ioDefs();
  }
  override _getShaderCode(uv: string, outputIndex: number, context: GenContext): ShaderCode {
    const source = this.getSource(outputIndex);
    return source ? source.generator._getShaderCode(uv, source.outputIndex, context) : defaultGeneratedShader();
  }
  override _serialize(data: Dict) {
    data.type = "ios";
    data.ports = structuredClone(this.ports);
    return data;
  }
  override _deserialize(data: Dict) {
    this.ports = structuredClone(data.ports ?? []);
  }
}

/* ---------- parameters panel / remote ---------- */
export class GenRemote extends Gen {
  widgets: Dict[] = [];

  override canBeDeleted() {
    return this.name !== "gen_parameters";
  }
  override getType() {
    return "remote";
  }
  override getTypeName() {
    return this.name === "gen_parameters" ? "Parameters" : "Remote";
  }
  nextWidgetName(): string {
    for (let i = 0; ; i++) if (!this.widgets.some((w) => w.name === "param" + i)) return "param" + i;
  }
  fix(): void {
    for (const w of this.widgets) if (!w.name) w.name = this.nextWidgetName();
    const parent = this.parent as GenGraph | null;
    if (!parent) return;
    this.widgets = this.widgets.filter((w) => {
      if (!w.linked_widgets) return true;
      w.linked_widgets = w.linked_widgets.filter((l: Dict) => {
        const g = parent.getNode(l.node);
        return g && g.getParameterDef(l.widget);
      });
      if (!w.linked_widgets.length) return false;
      if (!(w.name in this.parameters)) this.parameters[w.name] = 0;
      return true;
    });
  }
  override getParameterDefs(): ParameterDef[] {
    const rv: ParameterDef[] = [];
    const parent = this.parent as GenGraph | null;
    for (const w of this.widgets) {
      let p: ParameterDef;
      switch (w.type) {
        case "config_control": {
          const configs = Object.keys(w.configurations ?? {}).sort();
          if (configs.length === 2 && configs[0] === "False" && configs[1] === "True") p = { name: w.name, label: w.label, type: "boolean" };
          else p = { name: w.name, label: w.label, type: "enum", values: configs.map((c) => ({ name: c, value: c })) };
          break;
        }
        case "linked_control": {
          p = { name: w.name, type: "float" };
          const linked = w.linked_widgets?.[0];
          const g = linked && parent?.getNode(linked.node);
          const d = g?.getParameterDef(linked.widget);
          if (d) p = structuredClone(d);
          p.name = w.name;
          p.label = w.label;
          break;
        }
        case "named_parameter":
          p = { name: w.name, label: w.label, type: "float", min: w.min, max: w.max, step: w.step, default: w.default };
          break;
        default:
          continue;
      }
      p.widget_type = w.type;
      if (w.shortdesc) p.shortdesc = w.shortdesc;
      if (w.longdesc) p.longdesc = w.longdesc;
      rv.push(p);
    }
    return rv;
  }
  override setParameter(name: string, v: ParamValue): void {
    const parent = this.parent as GenGraph | null;
    const w = this.widgets.find((x) => x.name === name);
    if (parent && w) {
      switch (w.type) {
        case "linked_control":
          for (const l of w.linked_widgets ?? []) parent.getNode(l.node)?.setParameterSilently(l.widget, cloneValue(v));
          break;
        case "config_control": {
          let idx = typeof v === "boolean" ? (v ? 1 : 0) : Number(v);
          const configs = Object.keys(w.configurations ?? {}).sort();
          if (!(idx < configs.length)) return;
          idx = Math.max(0, Math.floor(idx));
          for (const l of w.configurations[configs[idx]]) parent.getNode(l.node)?.setParameterSilently(l.widget, deserializeValue(l.value));
          break;
        }
      }
    }
    this.parameters[name] = v;
    if (parent && this.name === "gen_parameters") parent.parameters[name] = v;
    this.changed();
  }
  getNamedParameters(): Record<string, string> {
    const rv: Record<string, string> = {};
    for (const w of this.widgets) if (w.type === "named_parameter") rv[w.name] = `${this.genName}_${w.name}`;
    return rv;
  }
  /** re-applies its values once it is in a graph (Godot's _enter_tree) */
  applyAll(): void {
    for (const k of Object.keys(this.parameters)) this.setParameter(k, deserializeValue(serializeValue(this.parameters[k])));
  }

  createLinkedControl(label: string): string {
    const n = this.nextWidgetName();
    this.widgets.push({ name: n, label, type: "linked_control", linked_widgets: [] });
    return n;
  }
  createConfigControl(label: string): string {
    const n = this.nextWidgetName();
    this.widgets.push({ name: n, label, type: "config_control", linked_widgets: [], configurations: {} });
    return n;
  }
  createNamedParameter(label: string, name = "", min = 0, max = 1, step = 0.01, def = 0.5): string {
    name = name || this.nextWidgetName();
    this.widgets.push({ name, label, type: "named_parameter", min, max, step, default: def });
    this.parameters[name] = def;
    this.changed();
    return name;
  }
  canLinkParameter(widgetName: string, g: Gen, param: string): boolean {
    if (g === this) return false;
    const w = this.widgets.find((x) => x.name === widgetName);
    if (!w) return false;
    if (w.linked_widgets?.length) {
      if (w.linked_widgets.some((l: Dict) => l.node === g.name && l.widget === param)) return false;
      if (w.type === "linked_control") {
        const l0 = w.linked_widgets[0];
        const a = (this.parent as GenGraph).getNode(l0.node)?.getParameterDef(l0.widget);
        const b = g.getParameterDef(param);
        if (!a || !b || a.type !== b.type) return false;
        if (a.type === "enum" && JSON.stringify(a.values) !== JSON.stringify(b.values)) return false;
      }
    }
    return true;
  }
  linkParameter(widgetName: string, g: Gen, param: string): void {
    if (!this.canLinkParameter(widgetName, g, param)) return;
    const w = this.widgets.find((x) => x.name === widgetName)!;
    w.linked_widgets.push({ node: g.name, widget: param });
    if (!(widgetName in this.parameters) || w.linked_widgets.length === 1) {
      if (w.type === "linked_control") this.parameters[widgetName] = cloneValue(g.getParameter(param));
      else this.parameters[widgetName] = 0;
    }
    this.changed();
  }
  removeParameter(name: string): void {
    this.widgets = this.widgets.filter((w) => w.name !== name);
    delete this.parameters[name];
    this.changed();
  }
  addConfiguration(widgetName: string, configName: string): void {
    const w = this.widgets.find((x) => x.name === widgetName);
    if (w?.type !== "config_control") return;
    w.configurations[configName] = [];
    this.updateConfiguration(widgetName, configName);
    this.parameters[w.name] = Object.keys(w.configurations).sort().indexOf(configName);
  }
  updateConfiguration(widgetName: string, configName: string): void {
    const w = this.widgets.find((x) => x.name === widgetName);
    const parent = this.parent as GenGraph | null;
    if (w?.type !== "config_control" || !parent) return;
    w.configurations[configName] = (w.linked_widgets ?? []).flatMap((l: Dict) => {
      const g = parent.getNode(l.node);
      return g ? [{ node: l.node, widget: l.widget, value: serializeValue(g.parameters[l.widget]) }] : [];
    });
    this.changed();
  }
  override _serialize(data: Dict) {
    data.type = "remote";
    data.widgets = structuredClone(this.widgets);
    return data;
  }
  override _deserialize(data: Dict) {
    this.widgets = structuredClone(data.widgets ?? []);
    this.fix();
  }
}

/* ---------- switch ---------- */
export class GenSwitch extends Gen {
  editable = false;
  override getType() {
    return "switch";
  }
  override getTypeName() {
    return "Switch";
  }
  override getDescription() {
    return "Switch\nSwitches between multiple inputs.";
  }
  override isEditable() {
    return this.editable;
  }
  override toggleEditable() {
    this.editable = !this.editable;
    return true;
  }
  get outputs() {
    return Math.round(Number(this.parameters.outputs ?? 2));
  }
  get choices() {
    return Math.round(Number(this.parameters.choices ?? 2));
  }
  override getParameterDefs(): ParameterDef[] {
    return [
      { name: "outputs", label: "Outputs", type: "float", min: 1, max: 5, step: 1, default: 2 },
      { name: "choices", label: "Choices", type: "float", min: 2, max: 5, step: 1, default: 2 },
      { name: "source", label: "Source", type: "float", min: 0, max: this.choices - 1, step: 1, default: 0 },
    ];
  }
  override getInputDefs(): PortDef[] {
    const rv: PortDef[] = [];
    for (let c = 0; c < this.choices; c++)
      for (let o = 0; o < this.outputs; o++) {
        const n = String.fromCharCode(65 + o) + (c + 1);
        rv.push({ name: n, label: n, type: "any" });
      }
    return rv;
  }
  override getOutputDefs(): PortDef[] {
    const rv: PortDef[] = [];
    for (let o = 0; o < this.outputs; o++) rv.push({ name: String.fromCharCode(65 + o), type: "any" });
    return rv;
  }
  override setParameter(p: string, v: ParamValue): void {
    const parent = this.parent as GenGraph | null;
    if (parent && (p === "outputs" || p === "choices")) {
      const nv = Math.round(Number(v));
      const ins: Record<number, number> = {},
        outs: Record<number, number> = {};
      const connectedIn = parent.connections.filter((c) => c.to === this.name).map((c) => c.to_port);
      const connectedOut = parent.connections.filter((c) => c.from === this.name).map((c) => c.from_port);
      if (p === "outputs") {
        for (const i of connectedIn) {
          const input = i % this.outputs,
            choice = Math.floor(i / this.outputs);
          ins[i] = input >= nv ? -1 : input + nv * choice;
        }
        for (const i of connectedOut) if (i >= nv) outs[i] = -1;
      } else for (const i of connectedIn) if (Math.floor(i / this.outputs) >= nv) ins[i] = -1;
      parent.reconnectInputs(this, ins);
      parent.reconnectOutputs(this, outs);
    }
    super.setParameter(p, v);
  }
  override followInput(i: number) {
    return [new OutputPort(this, i % this.outputs)];
  }
  override _getShaderCode(uv: string, outputIndex: number, context: GenContext): ShaderCode {
    const source = this.getSource(outputIndex + Math.round(Number(this.parameters.source ?? 0)) * this.outputs);
    return source ? source.generator._getShaderCode(uv, source.outputIndex, context) : defaultGeneratedShader();
  }
}

/* ---------- reroute ---------- */
export class GenReroute extends Gen {
  portType = "any";
  override getType() {
    return "reroute";
  }
  override getTypeName() {
    return "Reroute";
  }
  override getInputDefs(): PortDef[] {
    return [{ name: "in", type: this.currentType() }];
  }
  override getOutputDefs(): PortDef[] {
    return [{ type: this.currentType() }];
  }
  /** takes the type of what feeds it */
  currentType(): string {
    const s = this.parent?.getPortSource(this.name, 0);
    if (s && s.generator !== this) return s.generator.getOutputDefs()[s.outputIndex]?.type ?? this.portType;
    return this.portType;
  }
  override getParameterDefs(): ParameterDef[] {
    return [{ name: "preview", type: "enum", values: ["none", "small", "large", "huge"].map((v) => ({ name: v, value: v })), default: 0 }];
  }
  override _getShaderCode(uv: string, outputIndex: number, context: GenContext): ShaderCode {
    const s = this.getSource(0);
    return s ? s.generator._getShaderCode(uv, s.outputIndex, context) : defaultGeneratedShader();
  }
}

/* ---------- portals (wireless links) ---------- */
export class GenPortal extends Gen {
  portType = "any";
  io: 0 | 1 = 0; // 0: in, 1: out
  color = { r: 1, g: 1, b: 1, a: 1 };
  override getType() {
    return "portal";
  }
  override getTypeName() {
    return `Portal ${this.io === 0 ? "In" : "Out"}`;
  }
  override getInputDefs(): PortDef[] {
    return this.io === 0 ? [{ type: this.portType, shortdesc: "" }] : [];
  }
  override getOutputDefs(): PortDef[] {
    return this.io === 1 ? [{ type: this.portType, shortdesc: "" }] : [];
  }
  override getParameterDefs(): ParameterDef[] {
    return [{ name: "link", type: "string", default: "aperture_1" }];
  }
  override followInput(): OutputPort[] {
    if (this.io === 1 || !this.parent) return [];
    return (this.parent as unknown as GenGraph).children.filter((p) => p instanceof GenPortal && p.io === 1 && p.parameters.link === this.parameters.link).map((p) => new OutputPort(p, 0));
  }
  findSource(): OutputPort | null {
    for (const w of (this.parent as unknown as GenGraph | null)?.children ?? [])
      if (w instanceof GenPortal && w.io === 0 && w !== this && w.parameters.link === this.parameters.link) return w.getSource(0);
    return null;
  }
  override _getShaderCode(uv: string, outputIndex: number, context: GenContext): ShaderCode {
    const s = this.findSource();
    return s ? s.generator._getShaderCode(uv, s.outputIndex, context) : defaultGeneratedShader();
  }
  override _serialize(data: Dict) {
    data.io = this.io;
    data.port_type = this.portType;
    data.color = { type: "Color", ...this.color };
    delete data.seed_int;
    return data;
  }
  override _deserialize(data: Dict) {
    if (data.io !== undefined) this.io = data.io ? 1 : 0;
    if (data.port_type) this.portType = data.port_type;
    if (data.color) this.color = { r: data.color.r, g: data.color.g, b: data.color.b, a: data.color.a };
  }
}

/* ---------- comments and other editor only nodes ---------- */
export class GenComment extends Gen {
  text = "";
  size = { x: 300, y: 200 };
  title = "Comment";
  color: Dict | null = null;
  override getType() {
    return "comment";
  }
  override getTypeName() {
    return "Comment";
  }
  override _serialize(data: Dict) {
    data.type = "comment";
    data.title = this.title;
    data.text = this.text;
    data.size = { ...this.size };
    if (this.color) data.color = this.color;
    return data;
  }
  override _deserialize(data: Dict) {
    if (data.text !== undefined) this.text = data.text;
    if (data.title !== undefined) this.title = data.title;
    if (data.size) this.size = { x: data.size.x, y: data.size.y };
    if (data.color) this.color = data.color;
  }
}

/** nodes this port keeps in files but does not run (brush, webcam without a camera, ...) */
export class GenPassthrough extends Gen {
  data: Dict = {};
  constructor(public typeName: string) {
    super();
  }
  override getType() {
    return this.typeName;
  }
  override getTypeName() {
    return this.typeName;
  }
  override _serialize(_d: Dict) {
    return { ...structuredClone(this.data), ..._d, type: this.typeName };
  }
  override _deserialize(data: Dict) {
    this.data = structuredClone(data);
  }
  override getOutputDefs(): PortDef[] {
    return this.data.outputs ?? [];
  }
}
