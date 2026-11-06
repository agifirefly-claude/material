/* One parameter's control, for every parameter type a Material Maker node can have. */
import type { Gen, ParameterDef } from "../../engine/gen/base";
import { Curve, Gradient, Lattice, Pixels, Polygon, Splines, deserializeValue, isColor, type ParamValue } from "../../engine/params/types";
import { FloatEdit } from "./FloatEdit";
import { ColorEdit } from "./ColorEdit";
import { GradientEdit } from "./GradientEdit";
import { CurveEdit, LatticeEdit, PixelsEdit, PolygonEdit, SplinesEdit } from "./ShapeEdits";
import { editor } from "../store";
import { t } from "../i18n";

/** "2:Label" places a parameter next to input 2 in Material Maker; here only the label part is shown */
export const paramLabel = (p: ParameterDef) => t((p.label ?? p.name).replace(/^\d+:/, "") || p.name);

const valueAs = <T,>(v: ParamValue, cls: { deserialize(v: unknown): T }, def: unknown): T => (v && typeof v === "object" && !isColor(v) && (v as object).constructor === (cls as unknown) ? (v as T) : cls.deserialize(v ?? def));

export function ParamControl({ gen, def, compact }: { gen: Gen; def: ParameterDef; compact?: boolean }) {
  const value = gen.getParameter(def.name);
  const set = (v: ParamValue) => gen.setParameter(def.name, v);
  switch (def.type) {
    case "float":
      return (
        <FloatEdit
          value={typeof value === "number" || typeof value === "string" ? value : Number(def.default ?? 0)}
          min={def.min ?? 0}
          max={def.max ?? 1}
          step={def.step ?? 0.005}
          allowExpr={gen.acceptFloatExpressions()}
          onChange={set}
          onCommit={() => editor.snapshot()}
          title={def.shortdesc}
          resetTo={typeof def.default === "number" || typeof def.default === "string" ? def.default : undefined}
        />
      );
    case "size": {
      const first = def.first ?? 4,
        last = def.last ?? 13;
      const opts = [];
      for (let i = first; i <= last; i++) opts.push(i);
      return (
        <select className="nodrag" value={Number(value)} onChange={(e) => set(+e.target.value)}>
          {opts.map((i) => (
            <option key={i} value={i}>
              {2 ** i}×{2 ** i}
            </option>
          ))}
        </select>
      );
    }
    case "enum":
      return (
        <select className="nodrag" value={Number(value ?? 0)} onChange={(e) => set(+e.target.value)} style={{ maxWidth: compact ? 140 : undefined }}>
          {(def.values ?? []).map((v, i) => (
            <option key={i} value={i}>
              {t(v.name)}
            </option>
          ))}
        </select>
      );
    case "boolean":
      return <input className="nodrag" type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked)} style={{ justifySelf: "start" }} />;
    case "color": {
      const c = isColor(value) ? value : typeof value === "number" ? { r: value, g: value, b: value, a: 1 } : (deserializeValue(def.default) as { r: number; g: number; b: number; a: number });
      return <ColorEdit value={c} onChange={set} />;
    }
    case "gradient":
      return <GradientEdit value={valueAs(value, Gradient, def.default)} onChange={set} compact={compact} />;
    case "curve":
      return compact ? <span className="pl">{t("curve")}</span> : <CurveEdit value={valueAs(value, Curve, def.default)} onChange={set} />;
    case "polygon":
    case "polyline":
      return compact ? <span className="pl">{def.type}</span> : <PolygonEdit value={valueAs(value, Polygon, def.default)} closed={def.type === "polygon"} onChange={set} />;
    case "lattice":
      return compact ? <span className="pl">{t("lattice")}</span> : <LatticeEdit value={valueAs(value, Lattice, def.default)} onChange={set} />;
    case "splines":
      return compact ? <span className="pl">{t("splines")}</span> : <SplinesEdit value={valueAs(value, Splines, def.default)} onChange={set} />;
    case "pixels":
      return compact ? <span className="pl">{t("pixels")}</span> : <PixelsEdit value={valueAs(value, Pixels, def.default)} onChange={set} />;
    case "image_path":
      return (
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className="nodrag"
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.onchange = () => {
                const f = input.files?.[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = () => set(String(r.result));
                r.readAsDataURL(f);
              };
              input.click();
            }}
          >
            {value ? t("Replace image…") : t("Load image…")}
          </button>
          {!compact && <input type="text" placeholder={t("or an image URL")} value={String(value ?? "").startsWith("data:") ? "" : String(value ?? "")} onChange={(e) => set(e.target.value)} />}
        </div>
      );
    case "string":
    case "file":
    default:
      return <input className="nodrag" type="text" value={String(value ?? "")} onChange={(e) => set(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />;
  }
}
