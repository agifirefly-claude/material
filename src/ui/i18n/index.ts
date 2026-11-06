/* Translations. As in Material Maker (Godot's TranslationServer), the English text is the key: node names,
 * parameter labels and descriptions go through Material Maker's own catalogs (public/data/locale), and the strings
 * this port adds go through its own (./extra.ts). */
import { useSyncExternalStore } from "react";
import { EXTRA } from "./extra";

export const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "fr", label: "Français" },
];

let lang = "en";
let catalog: Record<string, string> = {};
const listeners = new Set<() => void>();
let version = 0;

export function currentLanguage(): string {
  return lang;
}

/** the language to start in: the saved choice, else the browser's */
export function initialLanguage(): string {
  try {
    const saved = localStorage.getItem("material-pro:lang");
    if (saved) return saved;
  } catch {
    /* storage blocked */
  }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "en").toLowerCase();
  return LANGUAGES.find((l) => nav.startsWith(l.code))?.code ?? "en";
}

export async function setLanguage(code: string, base = "data/"): Promise<void> {
  let cat: Record<string, string> = {};
  if (code !== "en") {
    try {
      cat = await fetch(`${base}locale/${code}.json`).then((r) => (r.ok ? r.json() : {}));
    } catch {
      cat = {};
    }
  }
  setCatalog(code, cat);
  try {
    localStorage.setItem("material-pro:lang", code);
  } catch {
    /* ignore */
  }
}

/** used by tests and by setLanguage */
export function setCatalog(code: string, cat: Record<string, string>): void {
  lang = code;
  catalog = { ...cat, ...(EXTRA[code] ?? {}) };
  version++;
  for (const l of listeners) l();
}

/** translates an English string; `{0}`, `{1}`… are replaced by the arguments */
export function t(s: string, ...args: (string | number)[]): string {
  let out = (s && catalog[s]) || s;
  if (out === s && s && lang !== "en") {
    // the catalogs often hold a string without its trailing punctuation
    const trimmed = s.replace(/[.:…\s]+$/, "");
    const hit = catalog[trimmed] ?? catalog[trimmed.charAt(0).toUpperCase() + trimmed.slice(1)];
    if (hit) out = hit + s.slice(trimmed.length);
  }
  args.forEach((a, i) => (out = out.replaceAll(`{${i}}`, String(a))));
  return out;
}

/** a multi-line description, translated whole or line by line */
export function tDesc(s: string | undefined): string {
  if (!s) return "";
  if (catalog[s]) return catalog[s];
  return s
    .split("\n")
    .map((l) => t(l))
    .join("\n");
}

/** a library path such as "Filter/Blur/Gaussian", each part translated */
export function tPath(p: string): string {
  return p
    .split("/")
    .map((x) => t(x))
    .join("/");
}

export function useLang(): string {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return lang;
}
