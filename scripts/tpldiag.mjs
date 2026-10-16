// Diagnostic: dump the boxer template's per-mesh geometry bounds and the
// world transform each one carries, plus the overall bind-pose bbox.
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
await page.waitForTimeout(9000);

const info = await page.evaluate(() => {
  const g = window.__ringOfFire;
  if (!g.boxer) return { boxer: false };
  const scene = g.boxer.scene;
  scene.updateMatrixWorld(true);
  const rows = [];
  const min = [1e9, 1e9, 1e9];
  const max = [-1e9, -1e9, -1e9];
  scene.traverse((o) => {
    const s = o.getWorldScale(new o.position.constructor());
    if (!o.isMesh) {
      rows.push(`NODE ${o.name || o.type} scale=${s.x.toFixed(5)}`);
      return;
    }
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
    rows.push(
      `MESH ${o.name} ws=${s.x.toFixed(5)} raw=[${bb.min.y.toFixed(3)}, ${bb.max.y.toFixed(3)}] local=${o.isSkinnedMesh ? "skinned" : "mesh"}`,
    );
  });
  return {
    boxer: true,
    height: g.boxer.height,
    minY: g.boxer.minY,
    union: { min: min.map((n) => +n.toFixed(4)), max: max.map((n) => +n.toFixed(4)) },
    rows,
  };
});

console.log(JSON.stringify(info, null, 1));
console.log("--- console ---");
console.log(logs.slice(0, 20).join("\n") || "(clean)");
await browser.close();
