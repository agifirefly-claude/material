/* Node libraries, ported from material_maker/tools/library_manager: the base library that ships with Material Maker,
 * the user's own library and any number of libraries the user creates or imports. User libraries live in the browser
 * and import/export as Material Maker library files ({ name, lib: [...] }). Also kept: which libraries and sections
 * are hidden, how often each item was used (to sort the add-node popup), user aliases and the quick-add bar. */
import { registry, type LibraryItem } from "../../engine/registry";

export interface Library {
  id: string;
  name: string;
  builtin: boolean;
  items: LibraryItem[];
}

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const memory = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

const KEY = "material-pro:libraries";
export const USER_LIBRARY = "user";

interface Saved {
  libraries: { id: string; name: string; items: LibraryItem[] }[];
  disabled: string[];
  disabledSections: string[];
  usage: Record<string, number>;
  aliases: Record<string, string>;
  quick: string[];
}

export class LibraryManager {
  libraries: Library[] = [];
  disabled = new Set<string>();
  disabledSections = new Set<string>();
  usage: Record<string, number> = {};
  userAliases: Record<string, string> = {};
  /** tree items shown as buttons on the add-node popup (Material Maker's quick buttons) */
  quick: string[] = [];
  version = 0;
  private listeners = new Set<() => void>();
  private store: KeyValueStore;

  constructor(store?: KeyValueStore) {
    this.store = store ?? (typeof localStorage !== "undefined" ? localStorage : memory());
  }

  /** reads the saved state; the base library comes from the registry */
  load(): void {
    let saved: Partial<Saved> = {};
    try {
      saved = JSON.parse(this.store.getItem(KEY) ?? "{}");
    } catch {
      saved = {};
    }
    this.libraries = [{ id: "base", name: "Base library", builtin: true, items: registry.library }];
    const user = saved.libraries ?? [];
    if (!user.some((l) => l.id === USER_LIBRARY)) user.unshift({ id: USER_LIBRARY, name: "User library", items: [] });
    for (const l of user) this.libraries.push({ ...l, builtin: false });
    this.disabled = new Set(saved.disabled ?? []);
    this.disabledSections = new Set(saved.disabledSections ?? []);
    this.usage = saved.usage ?? {};
    this.userAliases = saved.aliases ?? {};
    this.quick = saved.quick ?? ["Simple/Shape", "Simple/Uniform", "Filter/Blend", "Filter/Colorize", "Noise/FBM", "Workflow/Buffer"];
    this.changed(false);
  }

  private save(): void {
    const data: Saved = {
      libraries: this.libraries.filter((l) => !l.builtin).map(({ id, name, items }) => ({ id, name, items })),
      disabled: [...this.disabled],
      disabledSections: [...this.disabledSections],
      usage: this.usage,
      aliases: this.userAliases,
      quick: this.quick,
    };
    try {
      this.store.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("Cannot save the libraries", e);
    }
  }

  private changed(save = true): void {
    if (save) this.save();
    this.version++;
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;

  library(id: string): Library | undefined {
    return this.libraries.find((l) => l.id === id);
  }

  /* ----- what the library panel and the popup show ----- */
  sections(): string[] {
    const s = new Set<string>();
    for (const l of this.libraries) for (const i of l.items) s.add(i.tree_item.split("/")[0]);
    return [...s];
  }
  isEnabled(id: string) {
    return !this.disabled.has(id);
  }
  toggleLibrary(id: string) {
    if (this.disabled.has(id)) this.disabled.delete(id);
    else this.disabled.add(id);
    this.changed();
  }
  toggleSection(name: string) {
    if (this.disabledSections.has(name)) this.disabledSections.delete(name);
    else this.disabledSections.add(name);
    this.changed();
  }

  /** items of the enabled libraries and sections, with the library each comes from */
  items(): (LibraryItem & { library: string })[] {
    const out: (LibraryItem & { library: string })[] = [];
    for (const l of this.libraries) {
      if (this.disabled.has(l.id)) continue;
      for (const i of l.items) if (!this.disabledSections.has(i.tree_item.split("/")[0])) out.push({ ...i, library: l.id });
    }
    return out;
  }

  aliases(treeItem: string): string {
    return [registry.aliases[treeItem], this.userAliases[treeItem]].filter(Boolean).join(",");
  }
  setAliases(treeItem: string, aliases: string) {
    if (aliases.trim()) this.userAliases[treeItem] = aliases.trim();
    else delete this.userAliases[treeItem];
    this.changed();
  }

  /** items matching a query, best first; with `byUsage`, the most used first among equally good matches */
  search(q: string, byUsage = false, translate: (s: string) => string = (s) => s): (LibraryItem & { library: string })[] {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const all = this.items();
    if (!words.length) return byUsage ? all.sort((a, b) => (this.usage[b.tree_item] ?? 0) - (this.usage[a.tree_item] ?? 0)) : all;
    const scored: [number, LibraryItem & { library: string }][] = [];
    for (const it of all) {
      const rawName = it.display_name ?? it.tree_item.split("/").pop() ?? "";
      const name = rawName.toLowerCase();
      const tname = translate(rawName).toLowerCase();
      const hay = (it.tree_item + " " + name + " " + tname + " " + translate(it.tree_item) + " " + it.type + " " + this.aliases(it.tree_item)).toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      let score = 0;
      for (const w of words) {
        const n = name.includes(w) ? name : tname;
        score += n === w ? 0 : n.startsWith(w) ? 1 : n.includes(w) ? 2 : String(it.type).includes(w) ? 3 : it.tree_item.toLowerCase().includes(w) ? 4 : 6;
      }
      let rank = score * 100 + it.tree_item.split("/").length;
      if (byUsage) rank -= Math.min(90, (this.usage[it.tree_item] ?? 0) * 3);
      scored.push([rank, it]);
    }
    return scored.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  }

  /** item_created: counts uses for sorting */
  itemCreated(treeItem: string) {
    this.usage[treeItem] = (this.usage[treeItem] ?? 0) + 1;
    this.changed();
  }

  setQuick(index: number, treeItem: string) {
    this.quick[index] = treeItem;
    this.changed();
  }

  /* ----- editing user libraries ----- */
  createLibrary(name: string): string {
    let id = "lib_" + name.toLowerCase().replace(/\W+/g, "_");
    while (this.library(id)) id += "_";
    this.libraries.push({ id, name, builtin: false, items: [] });
    this.changed();
    return id;
  }
  removeLibrary(id: string) {
    const l = this.library(id);
    if (!l || l.builtin || id === USER_LIBRARY) return;
    this.libraries = this.libraries.filter((x) => x !== l);
    this.disabled.delete(id);
    this.changed();
  }
  renameLibrary(id: string, name: string) {
    const l = this.library(id);
    if (!l || l.builtin) return;
    l.name = name;
    this.changed();
  }

  /** add_item: replaces an item with the same path, keeping its icon when the new one has none */
  addItem(id: string, treeItem: string, data: Record<string, unknown>, iconData?: string) {
    const l = this.library(id);
    if (!l || l.builtin) return;
    const item = { ...structuredClone(data), tree_item: treeItem, display_name: treeItem.split("/").pop() } as LibraryItem;
    const old = l.items.find((i) => i.tree_item === treeItem);
    if (iconData) item.icon_data = iconData;
    else if (old?.icon_data) item.icon_data = old.icon_data;
    if (old) l.items[l.items.indexOf(old)] = item;
    else l.items.push(item);
    this.changed();
  }
  removeItem(id: string, treeItem: string) {
    const l = this.library(id);
    if (!l || l.builtin) return;
    l.items = l.items.filter((i) => i.tree_item !== treeItem);
    this.changed();
  }
  renameItem(id: string, oldName: string, newName: string): boolean {
    const l = this.library(id);
    if (!l || l.builtin || l.items.some((i) => i.tree_item === newName)) return false;
    const it = l.items.find((i) => i.tree_item === oldName);
    if (!it) return false;
    it.tree_item = newName;
    it.display_name = newName.split("/").pop();
    this.changed();
    return true;
  }
  updateIcon(id: string, treeItem: string, iconData: string) {
    const it = this.library(id)?.items.find((i) => i.tree_item === treeItem);
    if (!it || this.library(id)!.builtin) return;
    it.icon_data = iconData;
    this.changed();
  }

  /* ----- files ----- */
  exportLibrary(id: string): string {
    const l = this.library(id);
    if (!l) return "{}";
    return JSON.stringify({ name: l.name, lib: l.items }, null, "\t");
  }
  /** load_library: a Material Maker library file becomes a new user library */
  importLibrary(text: string, fallbackName = "Imported library"): string {
    const data = JSON.parse(text);
    const items: LibraryItem[] = Array.isArray(data) ? data : data.lib;
    if (!Array.isArray(items) || items.some((i) => typeof i?.tree_item !== "string")) throw new Error("Not a Material Maker library");
    const id = this.createLibrary(data.name || fallbackName);
    this.library(id)!.items = items;
    this.changed();
    return id;
  }
}

export const libraries = new LibraryManager();
