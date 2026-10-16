// Footwork viewer: walks p1 across the ring and photographs the step cycle from
// the side, sampling every few frames so successive shots catch different points
// of the stride.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "shots/walk";
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

// Take the sim off the clock, run the intro out, and give the walker a lane.
await page.evaluate(() => {
  const g = window.__ringOfFire;
  cancelAnimationFrame(g.raf);
  const realRender = g.render.bind(g);
  g.render = () => {};
  for (let i = 0; i < 300; i++) g.frame(1 / 60);
  g.render = realRender;
  g.p1.pos.set(0, 0, 2.4);
  g.p2.pos.set(0, 0, -2.4);
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  for (const s of document.querySelectorAll(".screen, .hud, #hud, #commentary")) {
    s.style.visibility = "hidden";
  }
});

/** Photographs a profile view of p1's legs. */
async function shot(name, advance) {
  await page.evaluate((n) => {
    const g = window.__ringOfFire;
    for (let k = 0; k < n; k++) g.frame(1 / 60);
    const V = g.p1.pos.constructor;
    const yaw = g.p1.yaw;
    const t = new V(g.p1.pos.x, g.p1.groundY, g.p1.pos.z);
    const a = yaw + Math.PI / 2;
    g.cam.camera.position.set(
      t.x + Math.sin(a) * 3.4,
      g.p1.groundY + 0.9,
      t.z + Math.cos(a) * 3.4,
    );
    g.cam.camera.fov = 32;
    g.cam.camera.lookAt(t.x, g.p1.groundY + 0.6, t.z);
    g.cam.camera.updateProjectionMatrix();
    g.render();
  }, advance);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 120000 });
  console.log("shot:", name);
}

// Walking in.
await page.keyboard.down("w");
await page.waitForTimeout(120);
for (let i = 0; i < 12; i++) await shot(`f${String(i).padStart(2, "0")}`, 4);
await page.keyboard.up("w");

// Standing still again: the feet must settle back under the body.
await shot("z0-stop", 30);
await shot("z1-stop", 30);

// Strafing.
await page.keyboard.down("a");
await page.waitForTimeout(120);
for (let i = 0; i < 6; i++) await shot(`s${String(i).padStart(2, "0")}`, 5);
await page.keyboard.up("a");

console.log("--- console ---");
console.log(logs.slice(0, 30).join("\n") || "(clean)");
await browser.close();
