/* The 3D gizmo of the SDF builder (windows/sdf_builder/gizmo.gd, gizmo_arrow.gd, preview_3d.gd): three arrows that
 * move the selected item and three rings that turn it, drawn over the raymarched view. */
import * as THREE from "three";
import type { SdfScene } from "../../engine/sdf/builder";
import { localTransform3D, parentTransform3D, project, type Sdf3DCamera } from "../../engine/sdf/preview";

export interface Gizmo3D {
  origin: THREE.Vector3;
  /** unit axes the arrows and rings use */
  axes: THREE.Vector3[];
  /** which arrows (x, y, z) and rings are shown: gizmo.gd mode SDF2D shows arrows x, y and ring z */
  arrows: boolean[];
  rings: boolean[];
  /** world length of an arrow */
  length: number;
  parent: THREE.Matrix4;
  local: THREE.Matrix4;
}

/** the gizmo of an item, or null when the item has no transform to edit */
export function gizmoFor(scene: SdfScene[], item: SdfScene, category: string, cam: Sdf3DCamera, localAxes: boolean): Gizmo3D | null {
  const p = item.parameters;
  const hasPos = "position_x" in p && "position_y" in p;
  const has3dAngles = "angle_x" in p && "angle_y" in p && "angle_z" in p;
  const hasAngle = "angle" in p;
  if (!hasPos && !has3dAngles && !hasAngle) return null;
  const parent = parentTransform3D(scene, item.index);
  const local = localTransform3D(item);
  const world = parent.clone().multiply(local);
  const origin = new THREE.Vector3().setFromMatrixPosition(world);
  // 2D items inside 3D generators lie in their parent's plane: their gizmo uses the parent's orientation
  const basis = category === "SDF2D" ? parent : localAxes ? world : new THREE.Matrix4();
  const axes = [0, 1, 2].map((i) => new THREE.Vector3().setFromMatrixColumn(basis, i).normalize());
  const is2d = category === "SDF2D";
  return {
    origin,
    axes,
    arrows: [hasPos, hasPos, hasPos && !is2d && "position_z" in p],
    rings: is2d ? [false, false, hasAngle] : [has3dAngles, has3dAngles, has3dAngles || hasAngle],
    length: 0.12 * cam.dist,
    parent,
    local,
  };
}

type V2 = { x: number; y: number };
const toPx = (q: { x: number; y: number } | null, size: number): V2 | null => (q ? { x: q.x * size, y: q.y * size } : null);

export function arrowEnds(g: Gizmo3D, cam: Sdf3DCamera, size: number, i: number): [V2, V2] | null {
  const a = toPx(project(cam, g.origin), size);
  const b = toPx(project(cam, g.origin.clone().addScaledVector(g.axes[i], g.length)), size);
  return a && b ? [a, b] : null;
}

/** points of a ring around axis i, in pixels, with the world points they come from */
export function ringPoints(g: Gizmo3D, cam: Sdf3DCamera, size: number, i: number): { px: V2; world: THREE.Vector3 }[] {
  const u = g.axes[(i + 1) % 3],
    v = g.axes[(i + 2) % 3];
  const r = g.length * 0.75;
  const out: { px: V2; world: THREE.Vector3 }[] = [];
  for (let k = 0; k <= 48; k++) {
    const t = (k / 48) * Math.PI * 2;
    const w = g.origin.clone().addScaledVector(u, Math.cos(t) * r).addScaledVector(v, Math.sin(t) * r);
    const px = toPx(project(cam, w), size);
    if (px) out.push({ px, world: w });
  }
  return out;
}

/** gizmo_arrow.gd: how far along axis i a mouse move goes, in world units */
export function arrowDrag(g: Gizmo3D, cam: Sdf3DCamera, size: number, i: number, delta: V2): THREE.Vector3 | null {
  const e = arrowEnds(g, cam, size, i);
  if (!e) return null;
  const d = { x: e[1].x - e[0].x, y: e[1].y - e[0].y };
  const l2 = d.x * d.x + d.y * d.y;
  if (l2 === 0) return null;
  const amount = ((delta.x * d.x + delta.y * d.y) / l2) * g.length;
  return g.axes[i].clone().multiplyScalar(amount);
}

/** the position parameters for a new world position of the item (preview_3d.gd _on_Gizmo_translated) */
export function positionParams(g: Gizmo3D, worldOrigin: THREE.Vector3, item: SdfScene): Record<string, number> {
  const l = worldOrigin.clone().applyMatrix4(g.parent.clone().invert());
  const out: Record<string, number> = { position_x: l.x, position_y: l.y };
  if ("position_z" in item.parameters) out.position_z = l.z;
  return out;
}

/** the ring drag direction in pixels for a grab point (gizmo_arrow.gd _on_RotateArea_input_event) */
export function ringDirection(g: Gizmo3D, cam: Sdf3DCamera, size: number, i: number, grab: THREE.Vector3): V2 | null {
  const tangent = grab.clone().sub(g.origin).cross(g.axes[i]);
  const a = toPx(project(cam, grab), size);
  const b = toPx(project(cam, grab.clone().add(tangent.normalize().multiplyScalar(grab.distanceTo(g.origin)))), size);
  return a && b ? { x: b.x - a.x, y: b.y - a.y } : null;
}

/** the angle parameters after turning the item by `amount` radians around axis i (preview_3d.gd _on_Gizmo_rotated) */
export function rotationParams(g: Gizmo3D, i: number, amount: number, item: SdfScene): Record<string, number> {
  const axis = g.axes[i].clone().transformDirection(g.parent.clone().invert());
  const pos = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3();
  g.local.decompose(pos, q, s);
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, amount));
  const e = new THREE.Euler().setFromQuaternion(q, "YXZ");
  const deg = (r: number) => (r * 180) / Math.PI;
  const out: Record<string, number> = {};
  if ("angle_x" in item.parameters) {
    out.angle_x = deg(e.x);
    out.angle_y = deg(e.y);
    out.angle_z = deg(e.z);
  }
  if ("angle" in item.parameters) out.angle = deg(e.z);
  return out;
}
