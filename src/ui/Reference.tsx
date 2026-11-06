/* Reference images (port of panels/reference): load or paste images, zoom and pan them, and pick colours and
 * gradients from them into slots that can be dragged onto colour and gradient parameters. */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Gradient, type Color } from "../engine/params/types";
import { css } from "./widgets/ColorEdit";
import { gradientCss } from "./widgets/GradientEdit";

import { COLOR_MIME, GRADIENT_MIME } from "./widgets/dnd";

interface RefImage {
  url: string;
  name: string;
  scale: number;
  center: { x: number; y: number };
  img?: HTMLImageElement;
}

/** the images stay while the editor is open, whichever panel is shown */
class ReferenceStore {
  images: RefImage[] = [];
  index = 0;
  version = 0;
  private listeners = new Set<() => void>();
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = () => this.version;
  emit() {
    this.version++;
    for (const l of this.listeners) l();
  }
  add(url: string, name = "image") {
    this.images.splice(this.images.length ? this.index + 1 : 0, 0, { url, name, scale: 1.1, center: { x: 0.5, y: 0.47 } });
    this.index = this.images.length === 1 ? 0 : this.index + 1;
    this.emit();
  }
  addFile(f: File) {
    const r = new FileReader();
    r.onload = () => this.add(String(r.result), f.name);
    r.readAsDataURL(f);
  }
  remove() {
    this.images.splice(this.index, 1);
    this.index = Math.max(0, Math.min(this.index - 1, this.images.length - 1));
    this.emit();
  }
  go(i: number) {
    if (!this.images.length) return;
    this.index = ((i % this.images.length) + this.images.length) % this.images.length;
    this.emit();
  }
}
export const references = new ReferenceStore();

type Slot = { kind: "color"; color: Color } | { kind: "gradient"; gradient: Gradient };

export function ReferencePanel() {
  useSyncExternalStore(references.subscribe, references.get);
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<Slot[]>([
    { kind: "color", color: { r: 0, g: 0, b: 0, a: 1 } },
    { kind: "color", color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } },
    { kind: "color", color: { r: 1, g: 1, b: 1, a: 1 } },
    { kind: "color", color: { r: 1, g: 0, b: 0, a: 1 } },
    { kind: "color", color: { r: 0, g: 0, b: 1, a: 1 } },
    { kind: "gradient", gradient: new Gradient() },
  ]);
  const [picking, setPicking] = useState<number | null>(null);
  const [nearest, setNearest] = useState(false);
  const [box, setBox] = useState({ w: 300, h: 300 });
  const current = references.images[references.index];

  useEffect(() => {
    const ro = new ResizeObserver(() => host.current && setBox({ w: host.current.clientWidth, h: host.current.clientHeight }));
    ro.observe(host.current!);
    return () => ro.disconnect();
  }, []);

  // draw the image with its zoom and pan, like the reference shader
  useEffect(() => {
    const c = canvas.current!;
    c.width = box.w;
    c.height = box.h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, c.width, c.height);
    if (!current) return;
    const draw = () => {
      const img = current.img!;
      const fit = Math.min(c.width / img.width, c.height / img.height) / current.scale;
      ctx.imageSmoothingEnabled = !nearest;
      ctx.drawImage(img, c.width / 2 - current.center.x * img.width * fit, c.height / 2 - current.center.y * img.height * fit, img.width * fit, img.height * fit);
    };
    if (current.img?.complete) draw();
    else {
      const img = new Image();
      img.onload = () => {
        current.img = img;
        draw();
      };
      img.src = current.url;
    }
  }, [current, current?.scale, current?.center.x, current?.center.y, box, nearest, references.version]);

  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (!host.current?.isConnected) return;
      for (const it of e.clipboardData?.items ?? []) {
        const f = it.kind === "file" ? it.getAsFile() : null;
        if (f && f.type.startsWith("image/")) references.addFile(f);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, []);

  const colorAt = (e: { clientX: number; clientY: number }): Color => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const d = c.getContext("2d")!.getImageData(Math.floor(((e.clientX - r.left) / r.width) * c.width), Math.floor(((e.clientY - r.top) / r.height) * c.height), 1, 1).data;
    return { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: 1 };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!current) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    if (picking !== null) {
      const slot = picking;
      const first = colorAt(e);
      let sum = { ...first },
        n = 1;
      const g = new Gradient();
      g.points = [{ v: 0, c: first }];
      let length = 0;
      let last = { x: e.clientX, y: e.clientY };
      const update = (s: Slot) => setSlots((ss) => ss.map((x, i) => (i === slot ? s : x)));
      update(slots[slot].kind === "color" ? { kind: "color", color: first } : { kind: "gradient", gradient: g.clone() });
      const move = (ev: PointerEvent) => {
        const col = colorAt(ev);
        if (slots[slot].kind === "color") {
          // dragging averages the colours under the cursor
          n++;
          sum = { r: sum.r + col.r, g: sum.g + col.g, b: sum.b + col.b, a: 1 };
          update({ kind: "color", color: { r: sum.r / n, g: sum.g / n, b: sum.b / n, a: 1 } });
        } else {
          // dragging records the colours along the stroke
          const nl = length + Math.hypot(ev.clientX - last.x, ev.clientY - last.y);
          last = { x: ev.clientX, y: ev.clientY };
          if (length > 0) for (const p of g.points) p.v = (p.v * length) / nl;
          g.points.push({ v: 1, c: col });
          length = nl;
          update({ kind: "gradient", gradient: g.clone() });
        }
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        setPicking(null);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      return;
    }
    // drag pans
    let lx = e.clientX,
      ly = e.clientY;
    const move = (ev: PointerEvent) => {
      const img = current.img;
      if (!img) return;
      const fit = Math.min(el.width / img.width, el.height / img.height) / current.scale;
      current.center = { x: Math.min(1, Math.max(0, current.center.x - (ev.clientX - lx) / (img.width * fit))), y: Math.min(1, Math.max(0, current.center.y - (ev.clientY - ly) / (img.height * fit))) };
      lx = ev.clientX;
      ly = ev.clientY;
      references.emit();
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <div className="preview-pane" style={{ flex: 1 }}>
      <div className="tools">
        <button
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.multiple = true;
            input.onchange = () => [...(input.files ?? [])].forEach((f) => references.addFile(f));
            input.click();
          }}
        >
          Add image…
        </button>
        <button disabled={!current} onClick={() => references.remove()}>
          Remove
        </button>
        {references.images.length > 1 && (
          <>
            <button onClick={() => references.go(references.index - 1)}>‹</button>
            <span>
              {references.index + 1}/{references.images.length}
            </span>
            <button onClick={() => references.go(references.index + 1)}>›</button>
          </>
        )}
        <label title="Show pixels without filtering">
          <input type="checkbox" checked={nearest} onChange={(e) => setNearest(e.target.checked)} /> nearest
        </label>
      </div>
      {current && (
        <div className="tools ref-slots">
          {slots.map((s, i) => (
            <div
              key={i}
              className={"ref-slot" + (s.kind === "gradient" ? " grad" : "") + (picking === i ? " picking" : "")}
              draggable
              title={(s.kind === "color" ? "Colour" : "Gradient") + ": click, then click or drag on the image to pick; drag the slot onto a parameter"}
              style={{ background: s.kind === "color" ? css(s.color) : gradientCss(s.gradient) }}
              onClick={() => setPicking(picking === i ? null : i)}
              onDragStart={(e) => {
                if (s.kind === "color") e.dataTransfer.setData(COLOR_MIME, JSON.stringify(s.color));
                else e.dataTransfer.setData(GRADIENT_MIME, JSON.stringify(s.gradient.serialize()));
                e.dataTransfer.effectAllowed = "copy";
              }}
            />
          ))}
        </div>
      )}
      <div
        className="body"
        ref={host}
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")).forEach((f) => references.addFile(f));
        }}
      >
        <canvas
          ref={canvas}
          style={{ width: "100%", height: "100%", cursor: picking !== null ? "crosshair" : current ? "grab" : "default" }}
          onPointerDown={onPointerDown}
          onWheel={(e) => {
            if (!current) return;
            current.scale = Math.min(3, Math.max(0.05, current.scale + (e.deltaY > 0 ? 0.05 : -0.05)));
            references.emit();
          }}
        />
        {!current && <div className="empty" style={{ position: "absolute" }}>Add, drop or paste reference images; pick colours and gradients from them.</div>}
      </div>
    </div>
  );
}
