// Dev helper: slice a skinned mesh into horizontal slabs and report the
// silhouette extents, so procedural add-ons can be sized to the model.
// Usage: node scripts/glbslice.mjs assets/raw/Brute.glb
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "assets/raw/Brute.glb";
const buf = readFileSync(file);
let off = 12;
let g = null;
let binOff = 0;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  if (type === 0x4e4f534a) g = JSON.parse(buf.toString("utf8", off + 8, off + 8 + len));
  if (type === 0x004e4942) binOff = off + 8;
  off += 8 + len + ((4 - (len % 4)) % 4);
}

const TYPE_N = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM_N = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(i) {
  const a = g.accessors[i];
  const bv = g.bufferViews[a.bufferView];
  const n = NUM_N[a.type];
  const stride = bv.byteStride ?? n * TYPE_N[a.componentType];
  const base = binOff + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float64Array(a.count * n);
  for (let e = 0; e < a.count; e++) {
    for (let c = 0; c < n; c++) {
      const p = base + e * stride + c * TYPE_N[a.componentType];
      out[e * n + c] = a.componentType === 5126 ? buf.readFloatLE(p) : buf.readUInt16LE(p);
    }
  }
  return out;
}

const meshArg = process.argv[3];
for (let mi = 0; mi < g.meshes.length; mi++) {
  const m = g.meshes[mi];
  const node = g.nodes.find((n) => n.mesh === mi);
  const label = `${node?.name ?? "?"} (mesh ${mi})`;
  if (meshArg && !label.toLowerCase().includes(meshArg.toLowerCase())) continue;

  for (let pi = 0; pi < m.primitives.length; pi++) {
    const p = m.primitives[pi];
    const pos = readAccessor(p.attributes.POSITION);
    const cnt = g.accessors[p.attributes.POSITION].count;
    const SLABS = 26;
    let ymin = Infinity;
    let ymax = -Infinity;
    for (let v = 0; v < cnt; v++) {
      const y = pos[v * 3 + 1];
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
    console.log(`\n### ${label} prim ${pi}  verts=${cnt}  y=[${ymin.toFixed(3)}, ${ymax.toFixed(3)}]`);
    const step = (ymax - ymin) / SLABS;
    for (let s = 0; s < SLABS; s++) {
      const lo = ymin + s * step;
      const hi = lo + step;
      let mx = 0;
      let zlo = Infinity;
      let zhi = -Infinity;
      let n = 0;
      for (let v = 0; v < cnt; v++) {
        const y = pos[v * 3 + 1];
        if (y < lo || y > hi) continue;
        n++;
        mx = Math.max(mx, Math.abs(pos[v * 3]));
        zlo = Math.min(zlo, pos[v * 3 + 2]);
        zhi = Math.max(zhi, pos[v * 3 + 2]);
      }
      const bar = n ? "#".repeat(Math.round((mx / 1.25) * 40)) : "";
      console.log(
        `  y ${lo.toFixed(3).padStart(7)}..${hi.toFixed(3).padStart(7)}  n=${String(n).padStart(4)}  halfX=${mx.toFixed(3)}  z=[${(n ? zlo : 0).toFixed(3)}, ${(n ? zhi : 0).toFixed(3)}]  ${bar}`,
      );
    }
  }
}
