// Diagnostic: run a match head-lessly and report why the player struggles.
import { chromium } from "playwright";

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
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(process.env.URL ?? "http://127.0.0.1:5173/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(5000);

await page.click('[data-seg="rounds"] button[data-val="3"]');
await page.click('[data-seg="roundlen"] button[data-val="60"]');
await page.click("#start-btn");
await page.waitForTimeout(800);

const out = await page.evaluate(
  ({ PASSIVE, FASTROUNDS }) => {
  const g = window.__ringOfFire;
  cancelAnimationFrame(g.raf);
  const realRender = g.render.bind(g);
  g.render = () => {};
  g.paused = false;

  const log = [];
  let attempts = 0;
  let accepts = 0;
  const origTry = g.p1.tryPunch.bind(g.p1);
  g.p1.tryPunch = (k, t) => {
    attempts++;
    const ok = origTry(k, t);
    if (ok) accepts++;
    return ok;
  };
  let aiAttempts = 0;
  const origAi = g.p2.tryPunch.bind(g.p2);
  g.p2.tryPunch = (k, t) => {
    aiAttempts++;
    return origAi(k, t);
  };

  const passiveMode = PASSIVE;
  const keys = ["KeyJ", "KeyK", "KeyL"];
  let thrown = 0;
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));

  for (let chunk = 0; chunk < 90 && !g.match.finished; chunk++) {
    for (let i = 0; i < 240; i++) {
      if (!passiveMode && i % 15 === 0) {
        const code = keys[thrown % keys.length];
        thrown++;
        window.dispatchEvent(new KeyboardEvent("keydown", { code }));
        window.dispatchEvent(new KeyboardEvent("keyup", { code }));
      }
      if (g.match.phase === "down" && i % 5 === 0) {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
      }
      if (FASTROUNDS && g.match.phase === "fight") g.match.clock = Math.min(g.match.clock, 0.05);
      g.frame(1 / 60);
      if (g.match.finished) break;
    }
    log.push({
      chunk,
      phase: g.match.phase,
      round: g.match.round,
      clock: g.match.clockString,
      state: g.p1.state,
      stam: Math.round(g.p1.stamina),
      regenDelay: +g.p1.regenDelay.toFixed(2),
      stun: Math.round(g.p1.stun),
      thrown: g.p1.thrown,
      landed: g.p1.landed,
      attempts,
      accepts,
      hp: Math.round(g.p1.health),
      ehp: Math.round(g.p2.health),
      aiThrown: g.p2.thrown,
      aiLanded: g.p2.landed,
      aiAttempts,
      aiState: g.p2.state,
      dist: +Math.hypot(g.p2.pos.x - g.p1.pos.x, g.p2.pos.z - g.p1.pos.z).toFixed(2),
    });
  }
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
  g.render = realRender;
  return log;
  },
  { PASSIVE: process.env.PASSIVE === "1", FASTROUNDS: process.env.FASTROUNDS === "1" },
);

for (const r of out) console.log(JSON.stringify(r));
await browser.close();
