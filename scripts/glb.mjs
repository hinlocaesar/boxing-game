// Dev helper: dump the structure of a .glb so we can plan how to drive it.
// Usage: node scripts/glb.mjs assets/raw/Brute.glb
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "assets/raw/Brute.glb";
const buf = readFileSync(file);

if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a glb");
console.log(`glb version ${buf.readUInt32LE(4)}  length ${buf.readUInt32LE(8)}`);

let off = 12;
let json = null;
const chunks = [];
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  chunks.push({ type: type === 0x4e4f534a ? "JSON" : type === 0x004e4942 ? "BIN" : type.toString(16), len });
  if (type === 0x4e4f534a) json = JSON.parse(buf.toString("utf8", off + 8, off + 8 + len));
  off += 8 + len + ((4 - (len % 4)) % 4);
}
console.log("chunks:", chunks);

const g = json;
const kv = (o) => Object.entries(o ?? {}).map(([k, v]) => `${k}=${v}`).join(" ");

console.log("\n=== asset ===");
console.log(JSON.stringify(g.asset));

console.log("\n=== scenes ===");
for (const s of g.scenes ?? []) console.log(` scene "${s.name}" nodes=[${s.nodes}]`);

console.log(`\n=== nodes (${(g.nodes ?? []).length}) ===`);
(g.nodes ?? []).forEach((n, i) => {
  const bits = [];
  if (n.mesh !== undefined) bits.push(`mesh=${n.mesh}`);
  if (n.skin !== undefined) bits.push(`skin=${n.skin}`);
  if (n.children) bits.push(`children=[${n.children}]`);
  console.log(` ${String(i).padStart(3)} ${(n.name ?? "").padEnd(34)} ${bits.join(" ")}`);
});

console.log(`\n=== meshes (${(g.meshes ?? []).length}) ===`);
(g.meshes ?? []).forEach((m, i) => {
  console.log(` mesh ${i} "${m.name}" prims=${m.primitives.length}`);
  m.primitives.forEach((p, j) => {
    const posAcc = g.accessors[p.attributes.POSITION];
    console.log(
      `   prim ${j}: mat=${p.material} mode=${p.mode ?? 4} verts=${posAcc?.count} ` +
        `attrs=[${Object.keys(p.attributes).join(",")}] min=${kv(posAcc?.min)} max=${kv(posAcc?.max)}`,
    );
  });
});

console.log(`\n=== materials (${(g.materials ?? []).length}) ===`);
(g.materials ?? []).forEach((m, i) => {
  console.log(` mat ${i} "${m.name}"`);
  console.log(`   ${JSON.stringify(m).slice(0, 400)}`);
});

console.log(`\n=== textures/images ===`);
(g.textures ?? []).forEach((t, i) => console.log(` tex ${i} -> image ${t.source} sampler ${t.sampler}`));
(g.images ?? []).forEach((im, i) => {
  const bv = im.bufferView !== undefined ? g.bufferViews[im.bufferView] : null;
  console.log(` img ${i} "${im.name ?? ""}" mime=${im.mimeType} bytes=${bv?.byteLength ?? "uri"}`);
});

console.log(`\n=== skins (${(g.skins ?? []).length}) ===`);
(g.skins ?? []).forEach((s, i) => {
  console.log(` skin ${i} "${s.name}" joints=${s.joints.length} skeleton=${s.skeleton}`);
  console.log(`   ${s.joints.map((j) => g.nodes[j].name).join(", ")}`);
});

console.log(`\n=== animations (${(g.animations ?? []).length}) ===`);
(g.animations ?? []).forEach((a, i) => console.log(` anim ${i} "${a.name}" channels=${a.channels.length}`));
