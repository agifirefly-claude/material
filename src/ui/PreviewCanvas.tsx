import { useEffect, useRef, useState } from "react";
import type { Gen } from "../engine/gen/base";
import type { ShaderError } from "../engine/render/renderer";
import { previews } from "./previews";

/** a canvas that shows one output of a node, kept up to date by the preview scheduler */
export function PreviewCanvas({ gen, output, size, display, className, onError, checker }: { gen: Gen; output: number; size: number; display?: number; className?: string; onError?: (e: ShaderError | null) => void; checker?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [key] = useState(() => "pv:" + Math.random().toString(36).slice(2));
  useEffect(() => {
    const c = ref.current!;
    c.dataset.drawn = "";
    previews.set({ canvas: c, gen, output, size, key, onError, checker });
    return () => previews.remove(c);
  }, [gen, output, size, key, onError, checker]);
  return <canvas ref={ref} width={size} height={size} className={className} style={display ? { width: display, height: display } : undefined} />;
}
