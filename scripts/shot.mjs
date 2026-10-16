// Headless capture harness: boots the game in Chromium (SwiftShader WebGL),
// then drives the simulation at 60fps with rendering stubbed out so matches
// actually reach a conclusion, and writes PNGs I can inspect.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "shots";
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

const page = await browser.newPage({
  viewport: { width: 1440, height: 810 },
  deviceScaleFactor: 1,
});

const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 120000 });
  console.log(`shot: ${name}`);
};

/** Advance game time without waiting on the software renderer. */
const sim = async ({
  seconds,
  hold = null,
  punchEvery = 0,
  punchKeys = ["KeyJ"],
  stopOnFinish = true,
  mash = true,
  fastRounds = false,
} = {}) =>
  page.evaluate(
    ({ seconds, hold, punchEvery, punchKeys, stopOnFinish, mash, fastRounds }) => {
      const g = window.__ringOfFire;
      cancelAnimationFrame(g.raf);
      const realRender = g.render.bind(g);
      g.render = () => {};
      g.paused = false;

      if (hold) window.dispatchEvent(new KeyboardEvent("keydown", { code: hold }));

      const n = Math.round(seconds * 60);
      let thrown = 0;
      for (let i = 0; i < n; i++) {
        if (punchEvery > 0 && i % punchEvery === 0) {
          const code = punchKeys[thrown % punchKeys.length];
          thrown++;
          window.dispatchEvent(new KeyboardEvent("keydown", { code }));
          window.dispatchEvent(new KeyboardEvent("keyup", { code }));
        }
        if (mash && g.match && g.match.phase === "down" && i % 5 === 0) {
          window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
          window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
        }
        if (fastRounds && g.match && g.match.phase === "fight") {
          g.match.clock = Math.min(g.match.clock, 0.05);
        }
        g.frame(1 / 60);
        if (stopOnFinish && g.match && g.match.finished) break;
      }

      if (hold) window.dispatchEvent(new KeyboardEvent("keyup", { code: hold }));

      g.render = realRender;
      g.render();
      g.loop();

      const m = g.match;
      return {
        phase: m ? m.phase : "menu",
        round: m ? m.round : 0,
        clock: m ? m.clockString : "-",
        finished: m ? m.finished : false,
        p1hp: g.p1 ? Math.round(g.p1.health) : 0,
        p2hp: g.p2 ? Math.round(g.p2.health) : 0,
      };
    },
    { seconds, hold, punchEvery, punchKeys, stopOnFinish, mash, fastRounds },
  );

const resultsVisible = () =>
  page.evaluate(() => !document.getElementById("results").classList.contains("hidden"));

await page.goto(URL, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(6000);

const gl = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const g = c.getContext("webgl2") || c.getContext("webgl");
  if (!g) return "no-webgl";
  const dbg = g.getExtension("WEBGL_debug_renderer_info");
  return dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "webgl-ok";
});
console.log("renderer:", gl);

await shot("01-menu");

/* ---- oblique look at the canvas texture (checks text orientation) ---- */
await page.evaluate(() => {
  const g = window.__ringOfFire;
  g.paused = true;
  for (const s of document.querySelectorAll(".screen")) s.style.visibility = "hidden";
  g.cam.camera.position.set(0, 7.6, 7.6);
  g.cam.camera.lookAt(0, 0.95, 0);
  g.cam.camera.updateProjectionMatrix();
});
await page.waitForTimeout(700);
await shot("02-canvas-top");
await page.evaluate(() => {
  for (const s of document.querySelectorAll(".screen")) s.style.visibility = "";
  window.__ringOfFire.paused = false;
});

/* ---- short match ---- */
await page.click('[data-seg="rounds"] button[data-val="3"]');
await page.click('[data-seg="roundlen"] button[data-val="60"]');
await page.click('[data-seg="difficulty"] button[data-val="pro"]');
await page.click("#start-btn");
await page.waitForTimeout(1200);
await shot("03-intro");

console.log("intro:", JSON.stringify(await sim({ seconds: 4 })));
await shot("04-fight");

await sim({ seconds: 3, hold: "KeyW", punchEvery: 14, punchKeys: ["KeyJ", "KeyL"] });
await shot("05-punching");

await sim({ seconds: 4, hold: "KeyW", punchEvery: 12, punchKeys: ["KeyK", "KeyL", "KeyI"] });
await shot("06-exchange");

await sim({ seconds: 1.2, hold: "Space" });
await shot("07-blocking");

/* ---- pause overlay ---- */
await page.keyboard.down("Escape");
await page.waitForTimeout(1500);
await page.keyboard.up("Escape");
await page.waitForTimeout(800);
await shot("08-pause");
await page.keyboard.down("Escape");
await page.waitForTimeout(1500);
await page.keyboard.up("Escape");
await page.waitForTimeout(600);

/* ---- grind to a verdict ---- */
let knockdownShot = false;
let state = null;
for (let i = 0; i < 60; i++) {
  state = await sim({ seconds: 4, hold: "KeyW", punchEvery: 15, punchKeys: ["KeyJ", "KeyK", "KeyL"] });
  if (state.phase === "down" && !knockdownShot) {
    knockdownShot = true;
    await shot("09-knockdown");
  }
  if (i === 10) await shot("10-midfight");
  if (state.finished) break;
}
console.log("final state:", JSON.stringify(state));

await sim({ seconds: 6, stopOnFinish: false });
await shot("11-results");

/* ---- rematch, then run a passive fight out to a judges' decision ---- */
await page.click("#rematch-btn");
await page.waitForTimeout(900);
await shot("12-rematch-intro");
let dec = null;
for (let i = 0; i < 40; i++) {
  dec = await sim({ seconds: 6, punchEvery: 0, fastRounds: true });
  if (dec.finished) break;
}
console.log("decision state:", JSON.stringify(dec));
await sim({ seconds: 6, stopOnFinish: false });
await shot("13-decision");

/* ---- back to the menu ---- */
await page.click("#menu-btn");
await page.waitForTimeout(1200);
await shot("14-menu-return");

console.log("--- console ---");
console.log(logs.slice(0, 40).join("\n") || "(clean)");

await browser.close();
