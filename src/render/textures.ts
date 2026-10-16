import * as THREE from "three";
import type { FighterProfile } from "../core/types";

function surface(size: number, h = size): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas context unavailable");
  return { c, g };
}

/* ------------------------------------------------------------------ */
/* Gear surfacing                                                      */
/* ------------------------------------------------------------------ */

/*
 * Production gear never ships as flat colour: every surface carries a normal
 * and a roughness map, and those two do most of the work of reading as leather
 * or satin under a moving key light. There is no Substance Designer here, so
 * the maps are built the same way it builds them — a height field, differenced
 * into a normal, with roughness driven off the same field.
 *
 * All noise is lattice-wrapped at its own period, so the result tiles cleanly.
 */

/** Tileable value noise: the lattice wraps at `period`. */
function vnoise(x: number, y: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const w = (t: number) => t * t * (3 - 2 * t);
  const hash = (a: number, b: number) => {
    const s = Math.sin((((a % period) + period) % period) * 12.9898 + (((b % period) + period) % period) * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = w(xf);
  const v = w(yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal sum of `vnoise`, `oct` octaves, periodic over the unit square. */
function fbm(x: number, y: number, period: number, oct: number): number {
  let amp = 0.5;
  let f = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * f, y * f, period * f);
    norm += amp;
    f *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

export interface SurfaceMaps {
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

/** Height field -> (normal, roughness) pair, the way a DCC bake node does it. */
function surfaceMaps(
  size: number,
  height: (u: number, v: number) => number,
  rough: (h: number, u: number, v: number) => number,
): SurfaceMaps {
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) field[y * size + x] = height(x / size, y / size);
  }

  const nC = surface(size);
  const rC = surface(size);
  const nI = nC.g.createImageData(size, size);
  const rI = rC.g.createImageData(size, size);
  const relief = 3.2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = ((x - 1) + size) % size;
      const xp = (x + 1) % size;
      const ym = ((y - 1) + size) % size;
      const yp = (y + 1) % size;
      const dx = (field[y * size + xp] - field[y * size + xm]) * 0.5 * relief;
      const dy = (field[yp * size + x] - field[ym * size + x]) * 0.5 * relief;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      nI.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      nI.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      nI.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      nI.data[i + 3] = 255;
      const r = Math.max(0, Math.min(1, rough(field[y * size + x], x / size, y / size))) * 255;
      rI.data[i] = r;
      rI.data[i + 1] = r;
      rI.data[i + 2] = r;
      rI.data[i + 3] = 255;
    }
  }
  nC.g.putImageData(nI, 0, 0);
  rC.g.putImageData(rI, 0, 0);

  const normalMap = new THREE.CanvasTexture(nC.c);
  const roughnessMap = new THREE.CanvasTexture(rC.c);
  for (const t of [normalMap, roughnessMap]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  return { normalMap, roughnessMap };
}

let leather: SurfaceMaps | null = null;
let satin: SurfaceMaps | null = null;

/** Full-grain leather: pebbled grain over slow creases, as gloves and boots use. */
export function leatherMaps(): SurfaceMaps {
  if (!leather) {
    leather = surfaceMaps(
      256,
      (u, v) => {
        const grain = fbm(u * 34, v * 34, 34, 4);
        // A ridged band reads as the folding creases leather always has.
        const crease = 1 - Math.abs(fbm(u * 6, v * 6, 6, 3) * 2 - 1);
        return grain * 0.82 + crease * crease * 0.18;
      },
      (h) => 0.5 + h * 0.16,
    );
    leather.normalMap.repeat.set(6, 6);
    leather.roughnessMap.repeat.set(6, 6);
  }
  return leather;
}

/** Satin: a tight over-under weave, slicker across the threads than down them. */
export function satinMaps(): SurfaceMaps {
  if (!satin) {
    const threads = 72;
    const weave = (u: number, v: number): number => {
      const uu = u * threads;
      const vv = v * threads;
      const iu = Math.floor(uu);
      const iv = Math.floor(vv);
      const t = (iu + iv) % 2 === 0 ? uu - iu : vv - iv;
      return Math.sin(Math.PI * t);
    };
    satin = surfaceMaps(
      256,
      (u, v) => weave(u, v) * 0.55 + fbm(u * 5, v * 5, 5, 3) * 0.45,
      (h) => 0.3 + h * 0.12,
    );
    satin.normalMap.repeat.set(6, 6);
    satin.roughnessMap.repeat.set(6, 6);
  }
  return satin;
}


/* ------------------------------------------------------------------ */
/* Ring canvas (the bit the fighters stand on)                         */
/* ------------------------------------------------------------------ */

export function makeRingCanvasTexture(): THREE.CanvasTexture {
  const S = 1024;
  const A = 78;
  const { c: inner, g } = surface(S);

  g.fillStyle = "#141d38";
  g.fillRect(0, 0, S, S);

  const grad = g.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S * 0.72);
  grad.addColorStop(0, "#2a3763");
  grad.addColorStop(0.55, "#1b2647");
  grad.addColorStop(1, "#0d1428");
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);

  // Canvas weave
  g.globalAlpha = 0.05;
  g.strokeStyle = "#ffffff";
  g.lineWidth = 1;
  for (let i = 0; i < S; i += 7) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, S);
    g.moveTo(0, i);
    g.lineTo(S, i);
    g.stroke();
  }
  g.globalAlpha = 1;

  const cx = S / 2;
  const cy = S / 2;

  // Gold border frame
  g.strokeStyle = "#f7c948";
  g.lineWidth = 8;
  g.strokeRect(18, 18, S - 36, S - 36);
  g.strokeStyle = "rgba(247,201,72,0.35)";
  g.lineWidth = 3;
  g.strokeRect(40, 40, S - 80, S - 80);

  // Sponsor corner plates
  const plates: Array<[number, number, string]> = [
    [70, 70, "PBL"],
    [S - 250, 70, "TITAN GEAR"],
    [70, S - 130, "GOLD GLOVE"],
    [S - 250, S - 130, "SPORTSNET"],
  ];
  for (const [x, y, text] of plates) {
    g.fillStyle = "rgba(247,201,72,0.10)";
    g.fillRect(x, y, 180, 60);
    g.fillStyle = "#f7c948";
    g.font = "bold 30px Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, x + 90, y + 31);
  }

  // Centre emblem
  g.save();
  g.translate(cx, cy);

  g.beginPath();
  g.arc(0, 0, 250, 0, Math.PI * 2);
  g.strokeStyle = "rgba(247,201,72,0.85)";
  g.lineWidth = 6;
  g.stroke();

  g.beginPath();
  g.arc(0, 0, 232, 0, Math.PI * 2);
  g.strokeStyle = "rgba(247,201,72,0.3)";
  g.lineWidth = 2;
  g.stroke();

  const disc = g.createRadialGradient(0, 0, 10, 0, 0, 225);
  disc.addColorStop(0, "#a1150f");
  disc.addColorStop(0.7, "#6d0f0b");
  disc.addColorStop(1, "#3a0705");
  g.beginPath();
  g.arc(0, 0, 225, 0, Math.PI * 2);
  g.fillStyle = disc;
  g.fill();

  g.fillStyle = "#f7c948";
  g.font = "italic 900 190px Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("ROF", 0, -6);

  g.fillStyle = "#ffe9a8";
  g.font = "bold 34px Arial, sans-serif";
  g.fillText("CHAMPIONSHIP", 0, 104);

  // Wordmark
  g.font = "bold 30px Arial, sans-serif";
  g.fillStyle = "rgba(247,201,72,0.8)";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("WORLD BOXING COUNCIL", 0, -166);
  g.fillText("EST. 2026", 0, 172);

  g.restore();

  // Under-canvas side text
  g.save();
  g.translate(cx, S - 120);
  g.fillStyle = "#e8322f";
  g.fillRect(-260, -34, 520, 68);
  g.fillStyle = "#ffffff";
  g.font = "italic 900 46px Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("RING OF FIRE", 0, 2);
  g.restore();

  // Compose: apron border + inner canvas.
  const { c, g: fg } = surface(S);
  fg.fillStyle = "#0a0e1c";
  fg.fillRect(0, 0, S, S);
  const apronGrad = fg.createLinearGradient(0, 0, 0, S);
  apronGrad.addColorStop(0, "#16223f");
  apronGrad.addColorStop(0.5, "#0d142a");
  apronGrad.addColorStop(1, "#16223f");
  fg.fillStyle = apronGrad;
  fg.fillRect(0, 0, S, S);
  fg.fillStyle = "#f7c948";
  fg.fillRect(0, 0, S, 5);
  fg.fillRect(0, S - 5, S, 5);
  fg.fillRect(0, 0, 5, S);
  fg.fillRect(S - 5, 0, 5, S);
  fg.fillStyle = "rgba(247,201,72,0.25)";
  fg.fillRect(A - 6, A - 6, S - 2 * (A - 6), 4);
  fg.fillRect(A - 6, S - A + 2, S - 2 * (A - 6), 4);
  fg.fillRect(A - 6, A - 6, 4, S - 2 * (A - 6));
  fg.fillRect(S - A + 2, A - 6, 4, S - 2 * (A - 6));

  fg.imageSmoothingQuality = "high";
  fg.drawImage(inner, A, A, S - 2 * A, S - 2 * A);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Ring apron (the padded skirt)                                       */
/* ------------------------------------------------------------------ */

export function makeApronTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 256;
  const { c, g } = surface(W, H);

  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#0b1020");
  grad.addColorStop(0.25, "#132043");
  grad.addColorStop(1, "#080b16");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  g.fillStyle = "#f7c948";
  g.fillRect(0, 0, W, 10);
  g.fillStyle = "rgba(232,50,47,0.9)";
  g.fillRect(0, 10, W, 6);

  g.fillStyle = "rgba(255,255,255,0.9)";
  g.font = "italic 900 96px Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let i = 0; i < 4; i++) {
    g.fillText("RING OF FIRE", (i + 0.5) * (W / 4), H * 0.55);
  }
  g.font = "bold 26px Arial, sans-serif";
  g.fillStyle = "#f7c948";
  for (let i = 0; i < 8; i++) {
    g.fillText("★", (i + 0.5) * (W / 8), H * 0.85);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/* ------------------------------------------------------------------ */
/* LED ribbon board around the arena                                   */
/* ------------------------------------------------------------------ */

export function makeRibbonTexture(): THREE.CanvasTexture {
  const W = 2048;
  const H = 128;
  const { c, g } = surface(W, H);

  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#05070d");
  grad.addColorStop(0.5, "#101c38");
  grad.addColorStop(1, "#05070d");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  g.fillStyle = "#f7c948";
  g.fillRect(0, 0, W, 4);
  g.fillRect(0, H - 4, W, 4);

  g.font = "bold 46px Arial, sans-serif";
  g.textBaseline = "middle";
  const segments = [
    "RING OF FIRE",
    "WORLD CHAMPIONSHIP",
    "LIVE FROM THE GRAND ARENA",
    "PBL BOXING",
  ];
  let x = 20;
  let si = 0;
  while (x < W) {
    const label = segments[si % segments.length];
    g.fillStyle = si % 2 === 0 ? "#f7c948" : "#ff5a4e";
    g.textAlign = "left";
    g.fillText(label, x, H / 2);
    x += g.measureText(label).width + 46;
    si++;
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Menu portraits                                                      */
/* ------------------------------------------------------------------ */

export function makeFighterPortrait(profile: FighterProfile): string {
  const S = 160;
  const { c, g } = surface(S);
  const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

  const bg = g.createRadialGradient(S / 2, S * 0.34, 6, S / 2, S * 0.5, S * 0.72);
  bg.addColorStop(0, hex(profile.colors.trunks));
  bg.addColorStop(1, "#070a11");
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);

  const cx = S / 2;

  // shoulders
  g.fillStyle = hex(profile.colors.skin);
  g.beginPath();
  g.ellipse(cx, S * 1.02, S * 0.42, S * 0.3, 0, 0, Math.PI * 2);
  g.fill();

  // trunks stripe
  g.fillStyle = hex(profile.colors.trim);
  g.fillRect(cx - S * 0.42, S * 0.92, S * 0.84, S * 0.1);

  // neck + head
  g.fillStyle = hex(profile.colors.skin);
  g.fillRect(cx - S * 0.09, S * 0.6, S * 0.18, S * 0.14);
  g.beginPath();
  g.ellipse(cx, S * 0.46, S * 0.19, S * 0.24, 0, 0, Math.PI * 2);
  g.fill();

  // hair
  g.fillStyle = hex(profile.colors.hair);
  g.beginPath();
  g.ellipse(cx, S * 0.34, S * 0.2, S * 0.16, 0, Math.PI, Math.PI * 2);
  g.fill();

  // eyes
  g.fillStyle = "#1a1a1a";
  g.beginPath();
  g.ellipse(cx - S * 0.07, S * 0.46, S * 0.022, S * 0.028, 0, 0, Math.PI * 2);
  g.ellipse(cx + S * 0.07, S * 0.46, S * 0.022, S * 0.028, 0, 0, Math.PI * 2);
  g.fill();

  // glove accent
  g.fillStyle = hex(profile.colors.gloves);
  g.beginPath();
  g.ellipse(cx + S * 0.34, S * 0.78, S * 0.13, S * 0.15, 0.4, 0, Math.PI * 2);
  g.ellipse(cx - S * 0.34, S * 0.78, S * 0.13, S * 0.15, -0.4, 0, Math.PI * 2);
  g.fill();

  const vign = g.createRadialGradient(cx, S / 2, S * 0.2, cx, S / 2, S * 0.62);
  vign.addColorStop(0, "rgba(0,0,0,0)");
  vign.addColorStop(1, "rgba(0,0,0,0.65)");
  g.fillStyle = vign;
  g.fillRect(0, 0, S, S);

  return c.toDataURL("image/png");
}
