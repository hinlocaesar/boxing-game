// Diagnostic: report the loaded fighter's world bounding box and joint
// positions so scale/placement errors are obvious.
import { chromium } from "playwright";

const URL = process.env.URL ?? "http://127.0.0.1:5173/";

const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-webgl", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(10000);

const info = await page.evaluate(() => {
  const g = window.__ringOfFire;
  const out = { demo: g.demo?.length ?? 0, hasP1: !!g.p1, boxer: !!g.boxer };
  const f = g.demo?.[0] ?? g.p1;
  if (!f) return out;
  out.tpl = { height: +g.boxer.height.toFixed(4), minY: +g.boxer.minY.toFixed(4) };
  out.rigJoints = Object.keys(f.model.rig.joints).length;
  out.joints = {};
  for (const [k, v] of Object.entries(f.model.rig.joints)) {
    const p = v.getWorldPosition(new f.pos.constructor());
    out.joints[k] = [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)];
  }
  out.pos = [+f.pos.x.toFixed(3), +f.pos.z.toFixed(3)];
  out.groundY = f.groundY;

  // Manual world-space bbox over every mesh: geometry corners * matrixWorld.
  const min = [1e9, 1e9, 1e9];
  const max = [-1e9, -1e9, -1e9];
  const meshes = [];
  f.container.updateMatrixWorld(true);
  f.container.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const e = o.matrixWorld.elements;
    for (let i = 0; i < 8; i++) {
      const x = i & 1 ? bb.max.x : bb.min.x;
      const y = i & 2 ? bb.max.y : bb.min.y;
      const z = i & 4 ? bb.max.z : bb.min.z;
      const w = [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
      for (let c = 0; c < 3; c++) {
        if (w[c] < min[c]) min[c] = w[c];
        if (w[c] > max[c]) max[c] = w[c];
      }
    }
    const s = o.getWorldScale(new f.pos.constructor());
    meshes.push(`${o.name || o.type} ws=${s.x.toFixed(4)} mat=${Array.isArray(o.material) ? "[]" : o.material.name}`);
  });
  out.bbox = { min: min.map((n) => +n.toFixed(3)), max: max.map((n) => +n.toFixed(3)) };
  out.meshes = meshes;
  return out;
});

console.log(JSON.stringify(info, null, 1));
console.log("--- console ---");
console.log(logs.slice(0, 20).join("\n") || "(clean)");
await browser.close();
