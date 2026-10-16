// Close-up model viewer: starts a bout, freezes it, and photographs the new
// anatomical fighter mesh from a few fixed angles.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "shots/model";
const URL = process.env.URL ?? "http://127.0.0.1:5173/";
fs.mkdirSync(OUT, { recursive: true });

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

await page.click('[data-seg="rounds"] button[data-val="3"]');
await page.click('[data-seg="roundlen"] button[data-val="60"]');
await page.click('[data-seg="difficulty"] button[data-val="pro"]');
await page.click("#start-btn");
await page.waitForTimeout(1500);

// Run some sim time so the guard settles, without rendering.
await page.evaluate(() => {
  const g = window.__ringOfFire;
  cancelAnimationFrame(g.raf);
  const realRender = g.render.bind(g);
  g.render = () => {};
  for (let i = 0; i < 240; i++) g.frame(1 / 60);
  g.render = realRender;
});

// Freeze the sim and hide the broadcast UI.
await page.evaluate(() => {
  const g = window.__ringOfFire;
  g.paused = true;
  for (const s of document.querySelectorAll(".screen, .hud, #hud, #commentary")) {
    s.style.visibility = "hidden";
  }
});

/** Orbit around a world point. */
const frames = [
  { name: "a-player-front", angle: 0.0, dist: 3.2, h: 1.05, focus: "p1" },
  { name: "b-player-34", angle: -0.7, dist: 3.0, h: 1.15, focus: "p1" },
  { name: "c-player-side", angle: -1.5, dist: 3.0, h: 1.05, focus: "p1" },
  { name: "d-opponent-front", angle: 0.0, dist: 3.0, h: 1.05, focus: "p2" },
  { name: "e-head-closeup", angle: -0.4, dist: 0.95, h: 1.62, focus: "head1" },
  { name: "f-torso-closeup", angle: -0.4, dist: 1.7, h: 1.25, focus: "chest1" },
  { name: "g-shoulder", angle: 0.9, dist: 1.1, h: 0, focus: "shoulder1" },
  { name: "h-knee", angle: 0.9, dist: 1.0, h: 0, focus: "knee1" },
  { name: "i-glove", angle: 2.5, dist: 1.05, h: 0, focus: "handL" },
  { name: "j-glove-front", angle: 3.6, dist: 1.05, h: 0, focus: "handL" },
  // Same view twice: once with the model's skin hidden, so any dark patch on
  // the gear can be blamed on the right object.
  { name: "k-glove-noskin", angle: 3.6, dist: 0.62, h: 0, focus: "handL", hideSkin: true },
  { name: "l-glove-skin", angle: 3.6, dist: 0.62, h: 0, focus: "handL" },
];

for (const f of frames) {
  await page.evaluate((fr) => {
    const g = window.__ringOfFire;
    const V = g.p1.pos.constructor;
    let t;
    if (fr.focus === "p1") t = new V(g.p1.pos.x, g.p1.groundY, g.p1.pos.z);
    else if (fr.focus === "p2") t = new V(g.p2.pos.x, g.p2.groundY, g.p2.pos.z);
    else if (fr.focus === "head1") t = g.p1.model.head.getWorldPosition(new V());
    else if (fr.focus === "shoulder1") t = g.p1.model.rig.joints.shoulderL.getWorldPosition(new V());
    else if (fr.focus === "knee1") t = g.p1.model.rig.joints.lowerLegL.getWorldPosition(new V());
    else if (fr.focus === "handL") t = g.p1.model.rig.joints.handL.getWorldPosition(new V());
    else t = g.p1.model.chest.getWorldPosition(new V());

    const closeUp = fr.focus !== "p1" && fr.focus !== "p2";
    const yaw = fr.focus === "p2" ? g.p2.yaw : g.p1.yaw;
    const a = yaw + Math.PI + fr.angle;
    const cx = t.x + Math.sin(a) * fr.dist;
    const cz = t.z + Math.cos(a) * fr.dist;
    const cy = closeUp ? t.y : g.p1.groundY + fr.h;
    g.cam.camera.position.set(cx, cy, cz);
    g.cam.camera.fov = 40;
    g.cam.camera.lookAt(t.x, closeUp ? t.y : g.p1.groundY + 0.95, t.z);
    g.cam.camera.updateProjectionMatrix();
    for (const o of [g.p1, g.p2]) {
      o.container.traverse((n) => {
        if (n.isSkinnedMesh) n.visible = !fr.hideSkin;
      });
    }
    g.render();
  }, f);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/${f.name}.png`, timeout: 120000 });
  console.log("shot:", f.name);
}

console.log("--- console ---");
console.log(logs.slice(0, 30).join("\n") || "(clean)");
await browser.close();
