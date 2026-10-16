// Dev helper: print a glb's node rest-pose world transforms (position + euler).
// Usage: node scripts/glbbones.mjs assets/raw/Brute.glb
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "assets/raw/Brute.glb";
const buf = readFileSync(file);
let off = 12;
let g = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  if (type === 0x4e4f534a) g = JSON.parse(buf.toString("utf8", off + 8, off + 8 + len));
  off += 8 + len + ((4 - (len % 4)) % 4);
}

// --- tiny mat4 helpers (column-major, like gl-matrix) ---
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function fromTRS(t, q, s) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}
function quatFromMat(m) {
  const t = m[0] + m[5] + m[10];
  let x, y, z, w;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    w = 0.25 * s; x = (m[6] - m[9]) / s; y = (m[8] - m[2]) / s; z = (m[1] - m[4]) / s;
  } else if (m[0] > m[5] && m[0] > m[10]) {
    const s = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2;
    w = (m[6] - m[9]) / s; x = 0.25 * s; y = (m[1] + m[4]) / s; z = (m[8] + m[2]) / s;
  } else if (m[5] > m[10]) {
    const s = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2;
    w = (m[8] - m[2]) / s; x = (m[1] + m[4]) / s; y = 0.25 * s; z = (m[6] + m[9]) / s;
  } else {
    const s = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2;
    w = (m[1] - m[4]) / s; x = (m[8] + m[2]) / s; y = (m[6] + m[9]) / s; z = 0.25 * s;
  }
  return [x, y, z, w];
}
const deg = (r) => (r * 180) / Math.PI;

const world = new Array(g.nodes.length).fill(null);
const parentOf = new Array(g.nodes.length).fill(-1);
g.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parentOf[c] = i)));

function build(i, parentM) {
  const n = g.nodes[i];
  const local = fromTRS(n.translation ?? [0, 0, 0], n.rotation ?? [0, 0, 0, 1], n.scale ?? [1, 1, 1]);
  const m = parentM ? mul(parentM, local) : local;
  world[i] = m;
  for (const c of n.children ?? []) build(c, m);
}
for (const r of g.scenes[0].nodes) build(r, null);

const name = (i) => (g.nodes[i].name ?? "").replace("mixamorig:", "");
const wanted = [
  "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "HeadTop_End",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
  "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
];
console.log("bone                  worldX   worldY   worldZ    | localPos                    | worldEuler(deg)");
for (let i = 0; i < g.nodes.length; i++) {
  const n = g.nodes[i];
  if (!wanted.includes(name(i))) continue;
  const m = world[i];
  const q = quatFromMat(m);
  const e = new (function () {})();
  // quat -> euler XYZ
  const [x, y, z, w] = q;
  const t0 = 2 * (w * x + y * z), t1 = 1 - 2 * (x * x + y * y);
  const t2 = 2 * (w * y - z * x);
  const t3 = 2 * (w * z + x * y), t4 = 1 - 2 * (y * y + z * z);
  e.x = Math.atan2(t0, t1); e.y = Math.asin(Math.max(-1, Math.min(1, t2))); e.z = Math.atan2(t3, t4);
  const lp = n.translation ?? [0, 0, 0];
  console.log(
    `${name(i).padEnd(20)} ${m[12].toFixed(3).padStart(8)} ${m[13].toFixed(3).padStart(8)} ${m[14].toFixed(3).padStart(8)}` +
      `  | ${lp.map((v) => v.toFixed(3).padStart(7)).join(" ")} |` +
      ` ${[e.x, e.y, e.z].map((v) => deg(v).toFixed(1).padStart(7)).join(" ")}`,
  );
}
void I;
