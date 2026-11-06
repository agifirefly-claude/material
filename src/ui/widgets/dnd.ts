/* Drag and drop of colours and gradients between the reference panel and parameter controls. */
import { Gradient, type Color } from "../../engine/params/types";

export const COLOR_MIME = "application/x-material-pro-color";
export const GRADIENT_MIME = "application/x-material-pro-gradient";

/** handlers that accept a dropped colour */
export function colorDrop(onColor: (c: Color) => void) {
  return {
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes(COLOR_MIME)) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      const d = e.dataTransfer.getData(COLOR_MIME);
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      onColor(JSON.parse(d));
    },
  };
}

/** handlers that accept a dropped gradient (or a colour, as a flat gradient) */
export function gradientDrop(onGradient: (g: Gradient) => void) {
  return {
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes(GRADIENT_MIME)) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      const d = e.dataTransfer.getData(GRADIENT_MIME);
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      onGradient(Gradient.deserialize(JSON.parse(d)));
    },
  };
}
