// Compares the game rig's hand joints against the model's own hand/finger
// bones so pose offsets show up as numbers instead of guesswork.
import { chromium } from "playwright";
import fs from "node:fs";

const URL = process.env.URL ?? "http://127.0.0.1:5173/";

const browser = await chromium.launch({
  args: [
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
    "--disable-dev-shm-usage",
  ],
});
const page = await browser.newPage({ viewport: { width: 900, height: 1150 }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(6000);
await page.click("#start-btn");
await page.waitForTimeout(1500);

await page.evaluate(() => {
  const g = window.__ringOfFire;
  cancelAnimationFrame(g.raf);
  g.render = () => {};
  for (let i = 0; i < 240; i++) g.frame(1 / 60);
});

const out = await page.evaluate(() => {
  const g = window.__ringOfFire;
  const p = g.p1;
  p.container.updateMatrixWorld(true);
  const v = (o) => {
    const w = o.getWorldPosition(new (g.p1.pos.constructor)());
    return [+w.x.toFixed(3), +w.y.toFixed(3), +w.z.toFixed(3)];
  };
  const names = [
    "mixamorigHips",
    "mixamorigSpine",
    "mixamorigSpine1",
    "mixamorigSpine2",
    "mixamorigNeck",
    "mixamorigHead",
    "mixamorigLeftShoulder",
    "mixamorigLeftArm",
    "mixamorigLeftForeArm",
    "mixamorigLeftHand",
    "mixamorigLeftHandIndex3",
    "mixamorigLeftHandMiddle3",
    "mixamorigLeftHandThumb3",
    "mixamorigRightShoulder",
    "mixamorigRightArm",
    "mixamorigRightForeArm",
    "mixamorigRightHand",
    "mixamorigRightHandIndex3",
    "mixamorigRightHandMiddle3",
    "mixamorigRightHandThumb3",
  ];
  const res = { rig: {}, bones: {}, quat: {} };
  for (const j of [
    "hips",
    "spine",
    "chest",
    "neck",
    "head",
    "shoulderL",
    "upperArmL",
    "foreArmL",
    "handL",
    "shoulderR",
    "upperArmR",
    "foreArmR",
    "handR",
  ]) {
    const o = p.model.rig.joints[j];
    if (o) res.rig[j] = v(o);
  }
  for (const n of names) {
    const o = p.container.getObjectByName(n);
    if (!o) {
      res.bones[n] = "MISSING";
      continue;
    }
    res.bones[n] = v(o);
    res.quat[n] = [+o.quaternion.x.toFixed(3), +o.quaternion.y.toFixed(3), +o.quaternion.z.toFixed(3), +o.quaternion.w.toFixed(3)];
  }
  res.guard = g.p1.anim ? "anim" : "no-anim";
  // Hand shape, expressed in the rig hand joint's own frame — the frame the
  // procedural glove is authored in.
  const V = g.p1.pos.constructor;
  res.hand = {};
  for (const side of ["Left", "Right"]) {
    const J = p.model.rig.joints[side === "Left" ? "handL" : "handR"];
    J.updateWorldMatrix(true, false);
    const inv = J.matrixWorld.clone().invert();
    const local = (o) => {
      o.updateWorldMatrix(true, false);
      const w = o.getWorldPosition(new V()).applyMatrix4(inv);
      return [+w.x.toFixed(3), +w.y.toFixed(3), +w.z.toFixed(3)];
    };
    const bone = (n) => {
      const o = p.container.getObjectByName(`mixamorig${side}${n}`);
      return o ? local(o) : "MISSING";
    };
    res.hand[side] = {
      wrist: local(p.container.getObjectByName(`mixamorig${side}Hand`) ?? J),
      thumb1: bone("HandThumb1"),
      thumb3: bone("HandThumb3"),
      index1: bone("HandIndex1"),
      index3: bone("HandIndex3"),
      middle1: bone("HandMiddle1"),
      middle3: bone("HandMiddle3"),
      pinky1: bone("HandPinky1"),
      pinky3: bone("HandPinky3"),
    };
  }
  // Real skinned vertices owned by each hand, so the true skin volume (mesh
  // thickness included) can be compared against the glove profile.
  const M4 = p.model.root.matrixWorld.constructor;
  const handBone = /mixamorig(Left|Right)(Hand|HandThumb|HandIndex|HandMiddle|HandRing|HandPinky)/i;
  const boxes = {};
  const slabs = {};
  const skinned = [];
  p.container.traverse((o) => {
    if (o.isSkinnedMesh) skinned.push(o);
  });
  // The glove shell, mirrored exactly as FighterModel builds it, so every
  // vertex can be tested for containment (q <= 1 is inside).
  const GLOVE = [
    { y: 0.135, rx: 0.016, rz: 0.02, cx: -0.004, cz: 0, exp: 2.0 },
    { y: 0.118, rx: 0.028, rz: 0.04, cx: -0.008, cz: 0, exp: 2.0 },
    { y: 0.09, rx: 0.036, rz: 0.054, cx: -0.012, cz: 0, exp: 2.0 },
    { y: 0.055, rx: 0.044, rz: 0.064, cx: -0.016, cz: 0, exp: 2.05 },
    { y: 0.015, rx: 0.052, rz: 0.072, cx: -0.018, cz: 0, exp: 2.05 },
    { y: -0.025, rx: 0.06, rz: 0.08, cx: -0.018, cz: 0.002, exp: 2.1 },
    { y: -0.06, rx: 0.064, rz: 0.092, cx: -0.019, cz: 0.004, exp: 2.15 },
    { y: -0.095, rx: 0.068, rz: 0.104, cx: -0.02, cz: 0.008, exp: 2.18 },
    { y: -0.125, rx: 0.07, rz: 0.11, cx: -0.022, cz: 0.013, exp: 2.2 },
    { y: -0.15, rx: 0.072, rz: 0.11, cx: -0.021, cz: 0.02, exp: 2.2 },
    { y: -0.175, rx: 0.066, rz: 0.098, cx: -0.016, cz: 0.026, exp: 2.15 },
    { y: -0.198, rx: 0.05, rz: 0.07, cx: -0.011, cz: 0.024, exp: 2.05 },
    { y: -0.216, rx: 0.036, rz: 0.05, cx: -0.008, cz: 0.02, exp: 2.0 },
    { y: -0.23, rx: 0.018, rz: 0.025, cx: -0.004, cz: 0.016, exp: 2.0 },
    { y: -0.238, rx: 0.007, rz: 0.01, cx: -0.002, cz: 0.012, exp: 2.0 },
  ];
  const overflow = (side, x, y, z) => {
    if (y > GLOVE[GLOVE.length - 1].y || y < GLOVE[0].y) return 0;
    let i = 0;
    while (i < GLOVE.length - 2 && GLOVE[i + 1].y < y) i++;
    const a = GLOVE[i];
    const b = GLOVE[i + 1];
    const t = (y - a.y) / (b.y - a.y);
    const L = (u, v) => u + (v - u) * t;
    const sx = side === "Left" ? 1 : -1;
    const cx = L(a.cx, b.cx) * sx;
    const cz = L(a.cz, b.cz);
    const e = L(a.exp, b.exp);
    return (
      Math.pow(Math.abs((x - cx) / L(a.rx, b.rx)), e) +
      Math.pow(Math.abs((z - cz) / L(a.rz, b.rz)), e) -
      1
    );
  };
  const out = { Left: [], Right: [] };
  const scratch = new V();
  for (const m of skinned) {
    const geo = m.geometry;
    const pa = geo.attributes.position;
    const si = geo.attributes.skinIndex;
    const sw = geo.attributes.skinWeight;
    if (!pa || !si || !sw) continue;
    const bones = m.skeleton.bones;
    const invs = m.skeleton.boneInverses;
    for (let i = 0; i < pa.count; i++) {
      // Fully skinned world position — every influence, not just the heaviest,
      // so the measurement matches what the GPU draws.
      scratch.fromBufferAttribute(pa, i);
      const acc = new V(0, 0, 0);
      let wsum = 0;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        const bi = si.getComponent(i, k);
        if (w <= 0 || !bones[bi]) continue;
        bones[bi].updateWorldMatrix(true, false);
        const local = new V().copy(scratch).applyMatrix4(new M4().copy(bones[bi].matrixWorld).multiply(invs[bi]));
        acc.addScaledVector(local, w);
        wsum += w;
      }
      if (wsum <= 0) continue;
      acc.multiplyScalar(1 / wsum);
      for (const side of ["Left", "Right"]) {
        const J = p.model.rig.joints[side === "Left" ? "handL" : "handR"];
        J.updateWorldMatrix(true, false);
        const w = new V().copy(acc).applyMatrix4(new M4().copy(J.matrixWorld).invert());
        if (Math.abs(w.x) > 0.3 || Math.abs(w.z) > 0.3) continue;
        if (w.y > 0.16 || w.y < -0.24) continue;
        const q = overflow(side, w.x, w.y, w.z);
        if (q > 0) out[side].push({ q: +q.toFixed(3), x: +w.x.toFixed(3), y: +w.y.toFixed(3), z: +w.z.toFixed(3) });
        if (side !== "Left") continue;
        let bx = boxes[side];
        if (!bx) bx = boxes[side] = { n: 0, x: [9, -9], y: [9, -9], z: [9, -9] };
        bx.n++;
        bx.x[0] = Math.min(bx.x[0], w.x);
        bx.x[1] = Math.max(bx.x[1], w.x);
        bx.y[0] = Math.min(bx.y[0], w.y);
        bx.y[1] = Math.max(bx.y[1], w.y);
        bx.z[0] = Math.min(bx.z[0], w.z);
        bx.z[1] = Math.max(bx.z[1], w.z);
        const band = Math.round(w.y / 0.02);
        let sb = slabs[side];
        if (!sb) sb = slabs[side] = {};
        const sl = (sb[band] ??= { n: 0, x: [9, -9], z: [9, -9] });
        sl.n++;
        sl.x[0] = Math.min(sl.x[0], w.x);
        sl.x[1] = Math.max(sl.x[1], w.x);
        sl.z[0] = Math.min(sl.z[0], w.z);
        sl.z[1] = Math.max(sl.z[1], w.z);
      }
    }
  }
  res.outside = {};
  for (const side of ["Left", "Right"]) {
    const list = out[side].sort((a, b) => b.q - a.q);
    res.outside[side] = { n: list.length, worst: list.slice(0, 6) };
  }
  res.handVerts = boxes;
  // Summarise each slab as centre + half-extent, the two numbers a loft
  // station wants (cx, rx, cz, rz).
  res.profile = {};
  for (const side of Object.keys(slabs)) {
    const rows = [];
    for (const k of Object.keys(slabs[side]).sort((a, b) => b - a)) {
      const s = slabs[side][k];
      if (s.n < 4) continue;
      const cx = (s.x[0] + s.x[1]) / 2;
      const cz = (s.z[0] + s.z[1]) / 2;
      rows.push({
        y: +(k * 0.02).toFixed(2),
        n: s.n,
        cx: +cx.toFixed(3),
        rx: +((s.x[1] - s.x[0]) / 2).toFixed(3),
        cz: +cz.toFixed(3),
        rz: +((s.z[1] - s.z[0]) / 2).toFixed(3),
      });
    }
    res.profile[side] = rows;
  }
  for (const side of Object.keys(boxes)) {
    const b = boxes[side];
    for (const k of ["x", "y", "z"]) b[k] = b[k].map((n) => +n.toFixed(3));
  }
  return res;
});

fs.mkdirSync("shots", { recursive: true });
fs.writeFileSync("shots/hands.json", JSON.stringify(out, null, 1));
const pairs = [
  ["hips", "mixamorigHips"],
  ["chest", "mixamorigSpine2"],
  ["neck", "mixamorigNeck"],
  ["head", "mixamorigHead"],
  ["handL", "mixamorigLeftHand"],
  ["handR", "mixamorigRightHand"],
];
for (const [rj, bn] of pairs) {
  const r = out.rig[rj];
  const b = out.bones[bn];
  if (!r || !b) continue;
  const d = [b[0] - r[0], b[1] - r[1], b[2] - r[2]].map((n) => +n.toFixed(4));
  console.log(rj.padEnd(7), "delta", JSON.stringify(d));
}
// Fingertip positions in the rig hand frame: x = across the palm, y = up the
// arm (the glove's cuff end), z = forward.
for (const side of ["Left", "Right"]) {
  const h = out.hand[side];
  console.log(`--- ${side} hand (rig-local) ---`);
  for (const k of Object.keys(h)) console.log("  ", k.padEnd(9), JSON.stringify(h[k]));
}
for (const [side, b] of Object.entries(out.handVerts ?? {})) {
  console.log(
    `--- ${side} hand skin (${b.n} verts) --- x`,
    JSON.stringify(b.x),
    "y",
    JSON.stringify(b.y),
    "z",
    JSON.stringify(b.z),
  );
}
for (const [side, o] of Object.entries(out.outside ?? {})) {
  console.log(`--- ${side} outside the glove: ${o.n} verts ---`);
  for (const w of o.worst) console.log(`   q=${w.q}  y=${w.y} x=${w.x} z=${w.z}`);
}
for (const [side, rows] of Object.entries(out.profile ?? {})) {
  if (side !== "Left") continue;
  console.log(`--- ${side} hand cross-sections (rig-local) ---`);
  console.log("    y      n    cx     rx     cz     rz");
  for (const r of rows) {
    console.log(
      `  ${String(r.y).padStart(6)}  ${String(r.n).padStart(4)}  ${String(r.cx).padStart(6)} ${String(r.rx).padStart(6)}  ${String(r.cz).padStart(6)} ${String(r.rz).padStart(6)}`,
    );
  }
}
console.log("--- console ---");
console.log(logs.slice(0, 20).join("\n") || "(clean)");
await browser.close();
