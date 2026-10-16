import * as THREE from "three";
import type { FighterProfile, Joint } from "../core/types";
import type { Rig } from "./Animator";
import type { BoxerBody } from "./BoxerBody";
import { leatherMaps, satinMaps } from "./textures";

/**
 * Fighter = downloaded boxer mesh + procedurally generated kit.
 *
 * The body, head, arms and hands come from `BoxerBody` (a retargeted Mixamo
 * character); everything a boxer *wears* â€” trunks, legs, boots, gloves â€” is
 * still loft geometry, sized from the model's own silhouette so the two
 * halves meet cleanly. Joint pivots come from the model's bind pose, so the
 * kit is positioned against real anatomy rather than guessed proportions.
 */

export interface FighterModel {
  root: THREE.Group;
  rig: Rig;
  head: THREE.Object3D;
  chest: THREE.Object3D;
  gloves: { L: THREE.Object3D; R: THREE.Object3D };
  body: BoxerBody;
  dispose(): void;
}

interface BuildCtx {
  disposables: Array<THREE.BufferGeometry | THREE.Material>;
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

function mat(
  ctx: BuildCtx,
  color: number,
  roughness = 0.62,
  metalness = 0.04,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  ctx.disposables.push(m);
  return m;
}

function shade(hex: number, k: number): number {
  return new THREE.Color(hex).multiplyScalar(k).getHex();
}

/* ------------------------------------------------------------------ */
/* Loft builder                                                        */
/* ------------------------------------------------------------------ */

/** Angular swell of the ring, centred on `a`, falling off over width `w`. */
interface Bump {
  a: number;
  amt: number;
  w: number;
}

interface Station {
  /** Position along the loft axis (local Y). */
  y: number;
  /** Half-extent along X. */
  rx: number;
  /** Half-extent along Z. */
  rz: number;
  /** Ring centre offsets. */
  cx?: number;
  cz?: number;
  /** Super-ellipse exponent: 2 = ellipse, higher = squarer. */
  exp?: number;
  bumps?: Bump[];
}

const FRONT = Math.PI / 2;
const BACK = -Math.PI / 2;

interface LoftOpts {
  segments?: number;
  castShadow?: boolean;
}

function loft(
  ctx: BuildCtx,
  stations: Station[],
  material: THREE.Material,
  opts: LoftOpts = {},
): THREE.Mesh {
  const seg = Math.max(6, opts.segments ?? 18);
  const st = stations
    .map((s) => ({ ...s }))
    .sort((a, b) => a.y - b.y)
    .filter((s, i, arr) => i === 0 || s.y - arr[i - 1].y > 1e-4);

  if (st.length < 2) throw new Error("loft needs at least two stations");

  const n = st.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const pt: number[] = [0, 0, 0];

  const ringPoint = (s: Station, j: number, out: number[]) => {
    const theta = (j / seg) * Math.PI * 2;
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    const e = s.exp ?? 2;
    const p = 2 / e;
    const nx = Math.sign(c) * Math.pow(Math.abs(c), p);
    const nz = Math.sign(sn) * Math.pow(Math.abs(sn), p);
    let k = 1;
    if (s.bumps) {
      for (const b of s.bumps) {
        let d = theta - b.a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const u = d / b.w;
        k += b.amt * Math.exp(-u * u);
      }
    }
    out[0] = (s.cx ?? 0) + s.rx * nx * k;
    out[1] = s.y;
    out[2] = (s.cz ?? 0) + s.rz * nz * k;
  };

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < seg; j++) {
      ringPoint(st[i], j, pt);
      positions.push(pt[0], pt[1], pt[2]);
    }
  }

  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      const a = i * seg + j;
      const b = i * seg + j2;
      const c = (i + 1) * seg + j2;
      const d = (i + 1) * seg + j;
      indices.push(a, d, c, a, c, b);
    }
  }

  // Closed caps, so the shell is a volume whose winding we can verify.
  const addCap = (ring: number, flip: boolean) => {
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (let j = 0; j < seg; j++) {
      mx += positions[(ring * seg + j) * 3];
      my += positions[(ring * seg + j) * 3 + 1];
      mz += positions[(ring * seg + j) * 3 + 2];
    }
    const centre = positions.length / 3;
    positions.push(mx / seg, my / seg, mz / seg);
    for (let j = 0; j < seg; j++) {
      const a = ring * seg + j;
      const b = ring * seg + ((j + 1) % seg);
      if (flip) indices.push(centre, b, a);
      else indices.push(centre, a, b);
    }
  };
  addCap(0, true);
  addCap(n - 1, false);

  let vol = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    vol +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  if (vol < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  // UVs: u wraps the ring, v runs along the loft. Gear has no hand-authored
  // unwrap, so this is the "smart UV" a DCC would project for a tube-like part —
  // without it a normal map can't be sampled at all.
  const uvs: number[] = [];
  const vs: number[] = [0];
  for (let i = 1; i < n; i++) {
    const dy = st[i].y - st[i - 1].y;
    const dr = Math.abs(st[i].rx - st[i - 1].rx) + Math.abs(st[i].rz - st[i - 1].rz);
    vs.push(vs[i - 1] + Math.hypot(dy, dr * 0.8));
  }
  const vTotal = Math.max(1e-4, vs[n - 1]);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < seg; j++) uvs.push(j / seg, vs[i] / vTotal);
  }
  uvs.push(0.5, 0);
  uvs.push(0.5, 1);
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  ctx.disposables.push(geo);

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = opts.castShadow !== false;
  mesh.receiveShadow = false;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

interface BlobOpts {
  scale: [number, number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
  seg?: number;
  shadow?: boolean;
}

/** A smooth ellipsoid, for parts that really are rounded volumes. */
function blob(ctx: BuildCtx, material: THREE.Material, opts: BlobOpts): THREE.Mesh {
  const seg = opts.seg ?? 16;
  const geo = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.75)));
  ctx.disposables.push(geo);
  const m = new THREE.Mesh(geo, material);
  m.scale.set(...opts.scale);
  m.position.set(...opts.position);
  if (opts.rotation) m.rotation.set(...opts.rotation);
  m.castShadow = opts.shadow !== false;
  return m;
}

/** Creates a named pivot group parented to `parent`. */
function pivot(
  parent: THREE.Object3D,
  name: string,
  position: [number, number, number],
  joints: Partial<Record<Joint, THREE.Object3D>>,
): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(...position);
  parent.add(g);
  joints[name as Joint] = g;
  return g;
}

/* ================================================================== */
/* Kit geometry                                                        */
/* ================================================================== */

/*
 * All of the numbers below were measured off the model's bind-pose
 * silhouette (see scripts/glbslice.mjs): waist halfX 0.238, hip halfX 0.221,
 * trouser leg halfX 0.25..0.27, and a floor 0.150 below the ankle bone.
 * Sizes are in metres in the same space as the joint pivots.
 */

/** The trunks: a soft bell over the hips, hem rolled under so it drapes. */
const TRUNKS: Station[] = [
  { y: -0.312, rx: 0.264, rz: 0.198, cz: -0.004, exp: 2.6 },
  { y: -0.288, rx: 0.284, rz: 0.214, cz: -0.005, exp: 2.65 },
  { y: -0.240, rx: 0.288, rz: 0.218, cz: -0.005, exp: 2.7, bumps: [{ a: BACK, amt: 0.04, w: 1.1 }] },
  { y: -0.170, rx: 0.272, rz: 0.208, cz: -0.004, exp: 2.8, bumps: [{ a: BACK, amt: 0.06, w: 1.1 }] },
  { y: -0.090, rx: 0.252, rz: 0.196, cz: -0.006, exp: 2.9 },
  { y: 0.000, rx: 0.236, rz: 0.184, cz: -0.008, exp: 3.0 },
  { y: 0.062, rx: 0.226, rz: 0.174, cz: -0.010, exp: 3.0 },
];

/** Glove shell, fitted to the model's fist cross-section by cross-section. */
const GLOVE: Station[] = [
  // The skin spans x[-0.076,0.040] y[-0.163,0] z[-0.081,0.113] in this frame,
  // widest (rz 0.092) at y=-0.14 — measured by scripts/hands.mjs.
  { y: 0.135, rx: 0.016, rz: 0.020, cx: -0.004, cz: 0.000, exp: 2.00 },
  { y: 0.118, rx: 0.028, rz: 0.040, cx: -0.008, cz: 0.000, exp: 2.00 },
  { y: 0.090, rx: 0.036, rz: 0.054, cx: -0.012, cz: 0.000, exp: 2.00 },
  { y: 0.055, rx: 0.044, rz: 0.064, cx: -0.016, cz: 0.000, exp: 2.05 },
  { y: 0.015, rx: 0.052, rz: 0.072, cx: -0.018, cz: 0.000, exp: 2.05 },
  { y: -0.025, rx: 0.060, rz: 0.080, cx: -0.018, cz: 0.002, exp: 2.10 },
  { y: -0.060, rx: 0.064, rz: 0.092, cx: -0.019, cz: 0.004, exp: 2.15, bumps: [{ a: FRONT, amt: 0.05, w: 1.2 }] },
  { y: -0.095, rx: 0.068, rz: 0.104, cx: -0.020, cz: 0.008, exp: 2.18 },
  { y: -0.125, rx: 0.070, rz: 0.110, cx: -0.022, cz: 0.013, exp: 2.20 },
  { y: -0.150, rx: 0.072, rz: 0.110, cx: -0.021, cz: 0.020, exp: 2.20 },
  { y: -0.175, rx: 0.066, rz: 0.098, cx: -0.016, cz: 0.026, exp: 2.15 },
  { y: -0.198, rx: 0.050, rz: 0.070, cx: -0.011, cz: 0.024, exp: 2.05 },
  { y: -0.216, rx: 0.036, rz: 0.050, cx: -0.008, cz: 0.020, exp: 2.00 },
  { y: -0.230, rx: 0.018, rz: 0.025, cx: -0.004, cz: 0.016, exp: 2.00 },
  { y: -0.238, rx: 0.007, rz: 0.010, cx: -0.002, cz: 0.012, exp: 2.00 },
];

/* ==================================================================== */
/* Build                                                                */
/* ==================================================================== */

export function buildFighter(profile: FighterProfile, body: BoxerBody): FighterModel {
  const ctx: BuildCtx = { disposables: [] };
  const c = profile.colors;

  // Gear surfacing. Roughness lives in the map (the base value is only the
  // multiplier), and the normal map carries the grain — flat colour on a curved
  // shell is what reads as untextured plastic.
  const weave = satinMaps();
  const hide = leatherMaps();

  const trunksMat = mat(ctx, c.trunks, 1, 0.03);
  trunksMat.normalMap = weave.normalMap;
  trunksMat.roughnessMap = weave.roughnessMap;
  trunksMat.normalScale.set(0.16, 0.16);

  const trim = mat(ctx, c.trim, 0.38, 0.22);

  const glove = mat(ctx, c.gloves, 1, 0.02);
  glove.normalMap = hide.normalMap;
  glove.roughnessMap = hide.roughnessMap;
  glove.normalScale.set(0.28, 0.28);

  const boot = mat(ctx, c.boots, 1, 0.04);
  boot.normalMap = hide.normalMap;
  boot.roughnessMap = hide.roughnessMap;
  boot.normalScale.set(0.28, 0.28);

  const bootTrim = mat(ctx, shade(c.trim, 1.1), 0.5, 0.08);
  // Laces and soles are their own materials on real gear, and they are what sell
  // it at a glance: an off-white lace on a black boot, a rubber sole under it.
  const lace = mat(ctx, 0xe9e4d8, 0.78, 0.0);
  const rubber = mat(ctx, 0x8b9098, 0.86, 0.02);

  const root = new THREE.Group();
  root.name = "fighterRoot";
  root.scale.setScalar(profile.bodyScale);

  const joints: Partial<Record<Joint, THREE.Object3D>> = {};

  const at = (j: Joint): [number, number, number] => {
    const v = body.layout[j];
    if (!v) throw new Error(`boxer model is missing joint "${j}"`);
    return [v.x, v.y, v.z];
  };
  const rel = (j: Joint, parent: Joint): [number, number, number] => {
    const a = body.layout[j];
    const b = body.layout[parent];
    if (!a || !b) throw new Error(`boxer model is missing joint "${j}" or "${parent}"`);
    return [a.x - b.x, a.y - b.y, a.z - b.z];
  };

  /* ---------------- torso chain ---------------- */
  const hips = pivot(root, "hips", at("hips"), joints);
  const spine = pivot(hips, "spine", rel("spine", "hips"), joints);
  const chest = pivot(spine, "chest", rel("chest", "spine"), joints);
  const neck = pivot(chest, "neck", rel("neck", "chest"), joints);
  const head = pivot(neck, "head", rel("head", "neck"), joints);

  /* ---------------- trunks ---------------- */
  hips.add(loft(ctx, TRUNKS, trunksMat, { segments: 26 }));
  hips.add(
    loft(
      ctx,
      TRUNKS.filter((s) => s.y >= -0.02).map((s) => ({ ...s, rx: s.rx + 0.005, rz: s.rz + 0.005 })),
      trim,
      { segments: 26 },
    ),
  );
  // Gold hem band, wrapping the very bottom of the bell so no red shows under
  // it — a band anywhere else reads as a second skirt.
  hips.add(
    loft(
      ctx,
      TRUNKS.filter((s) => s.y <= -0.288).map((s) => ({
        ...s,
        rx: s.rx + 0.004,
        rz: s.rz + 0.004,
      })),
      trim,
      { segments: 26 },
    ),
  );
  // Side stripe: a slim raised band that follows the flare of the bell.
  for (const sx of [1, -1]) {
    hips.add(
      loft(
        ctx,
        [
          { y: 0.052, rx: 0.014, rz: 0.052, cx: 0.220 * sx, cz: -0.010, exp: 2.4 },
          { y: -0.030, rx: 0.014, rz: 0.060, cx: 0.233 * sx, cz: -0.008, exp: 2.4 },
          { y: -0.110, rx: 0.014, rz: 0.064, cx: 0.249 * sx, cz: -0.006, exp: 2.4 },
          { y: -0.180, rx: 0.014, rz: 0.064, cx: 0.266 * sx, cz: -0.006, exp: 2.4 },
          { y: -0.248, rx: 0.013, rz: 0.056, cx: 0.279 * sx, cz: -0.006, exp: 2.4 },
        ],
        trim,
        { segments: 10 },
      ),
    );
  }

  /* ---------------- arms ---------------- */
  const gloves: { L?: THREE.Object3D; R?: THREE.Object3D } = {};

  for (const { side, sx } of [
    { side: "L" as const, sx: 1 },
    { side: "R" as const, sx: -1 },
  ]) {
    const shoulder = pivot(chest, `shoulder${side}` as Joint, rel(`shoulder${side}` as Joint, "chest"), joints);
    const upperArm = pivot(shoulder, `upperArm${side}` as Joint, rel(`upperArm${side}` as Joint, `shoulder${side}` as Joint), joints);
    const foreArm = pivot(upperArm, `foreArm${side}` as Joint, rel(`foreArm${side}` as Joint, `upperArm${side}` as Joint), joints);
    const hand = pivot(foreArm, `hand${side}` as Joint, rel(`hand${side}` as Joint, `foreArm${side}` as Joint), joints);

    hand.add(
      // cx flips with the hand: the model's right fist is mirrored, so its
      // knuckles sit at +x while the left fist's sit at -x.
      loft(
        ctx,
        GLOVE.map((s) => ({ ...s, cx: (s.cx ?? 0) * sx })),
        glove,
        { segments: 18 },
      ),
    );
    hand.add(
      loft(
        ctx,
        [
          { y: 0.078, rx: 0.042, rz: 0.061, cx: -0.019 * sx, cz: 0.000, exp: 2.0 },
          { y: 0.046, rx: 0.049, rz: 0.068, cx: -0.020 * sx, cz: 0.000, exp: 2.05 },
        ],
        trim,
        { segments: 16, castShadow: false },
      ),
    );
    hand.add(
      blob(ctx, glove, { scale: [0.030, 0.046, 0.038], position: [-0.054 * sx, -0.075, 0.030], rotation: [0.2, 0, 0.25 * sx], seg: 12 }),
    );

    // Lace-up cuff: bars down the palm side of the wrist, which is what makes a
    // glove read as laced rather than moulded.
    for (let i = 0; i < 3; i++) {
      const ly = 0.084 + i * 0.020;
      const lz = 0.050 - i * 0.008;
      hand.add(
        blob(ctx, lace, { scale: [0.024, 0.006, 0.012], position: [-0.010 * sx, ly, lz], seg: 8, shadow: false }),
      );
    }

    gloves[side] = hand;
  }

  /* ---------------- legs ---------------- */
  // The legs themselves are the model's own trouser mesh, re-materialled as
  // bare skin — it is already skinned to the leg bones, so it bends properly.
  // Only the boot is ours.
  for (const side of ["L", "R"] as const) {
    const upperLeg = pivot(hips, `upperLeg${side}` as Joint, rel(`upperLeg${side}` as Joint, "hips"), joints);
    const lowerLeg = pivot(upperLeg, `lowerLeg${side}` as Joint, rel(`lowerLeg${side}` as Joint, `upperLeg${side}` as Joint), joints);
    const foot = pivot(lowerLeg, `foot${side}` as Joint, rel(`foot${side}` as Joint, `lowerLeg${side}` as Joint), joints);

    // Boxing boot: shaft down the ankle, then a box that runs out to the toe.
    const SOLE = -at(`foot${side}` as Joint)[1];
    foot.add(
      loft(
        ctx,
        [
          { y: 0.160, rx: 0.056, rz: 0.058, cz: 0.000, exp: 2.05 },
          { y: 0.100, rx: 0.059, rz: 0.061, cz: -0.002, exp: 2.05 },
          { y: 0.050, rx: 0.060, rz: 0.063, cz: -0.008, exp: 2.10 },
          { y: -0.005, rx: 0.060, rz: 0.066, cz: -0.020, exp: 2.10 },
          { y: -0.060, rx: 0.059, rz: 0.066, cz: -0.032, exp: 2.10 },
          { y: -0.110, rx: 0.056, rz: 0.062, cz: -0.044, exp: 2.05 },
          { y: -0.152, rx: 0.044, rz: 0.036, cz: -0.052, exp: 2.0 },
        ],
        boot,
        { segments: 18 },
      ),
    );

    const toe = loft(
      ctx,
      [
        { y: -0.238, rx: 0.041, rz: 0.024, cz: SOLE + 0.024, exp: 2.20 },
        { y: -0.205, rx: 0.052, rz: 0.035, cz: SOLE + 0.035, exp: 2.20 },
        { y: -0.150, rx: 0.060, rz: 0.049, cz: SOLE + 0.046, exp: 2.20 },
        { y: -0.080, rx: 0.063, rz: 0.060, cz: SOLE + 0.058, exp: 2.15 },
        { y: -0.005, rx: 0.060, rz: 0.070, cz: SOLE + 0.070, exp: 2.10 },
        { y: 0.062, rx: 0.046, rz: 0.060, cz: SOLE + 0.060, exp: 2.05 },
      ],
      boot,
      { segments: 18 },
    );
    toe.rotation.x = -Math.PI / 2;
    foot.add(toe);

    // Sole: a slab proud of the boot all round, so it reads in silhouette.
    const sole = loft(
      ctx,
      [
        { y: -0.243, rx: 0.036, rz: 0.007, cz: SOLE + 0.010, exp: 2.7 },
        { y: -0.205, rx: 0.055, rz: 0.009, cz: SOLE + 0.011, exp: 2.7 },
        { y: -0.150, rx: 0.067, rz: 0.010, cz: SOLE + 0.011, exp: 2.7 },
        { y: -0.080, rx: 0.070, rz: 0.011, cz: SOLE + 0.012, exp: 2.7 },
        { y: -0.005, rx: 0.067, rz: 0.012, cz: SOLE + 0.013, exp: 2.6 },
        { y: 0.055, rx: 0.053, rz: 0.014, cz: SOLE + 0.017, exp: 2.5 },
      ],
      rubber,
      { segments: 18, castShadow: false },
    );
    sole.rotation.x = -Math.PI / 2;
    foot.add(sole);

    // Collar at the shaft's mouth, and laces up the instep.
    foot.add(
      loft(
        ctx,
        [
          { y: 0.170, rx: 0.057, rz: 0.059, cz: 0.000, exp: 2.05 },
          { y: 0.132, rx: 0.061, rz: 0.063, cz: -0.002, exp: 2.05 },
        ],
        bootTrim,
        { segments: 18, castShadow: false },
      ),
    );
    for (let i = 0; i < 4; i++) {
      foot.add(
        blob(ctx, lace, {
          scale: [0.031, 0.007, 0.012],
          position: [0, 0.078 - i * 0.031, 0.058 - i * 0.005],
          seg: 8,
          shadow: false,
        }),
      );
    }
  }

  /* ---------------- downloaded body ---------------- */
  root.add(body.object);

  return {
    root,
    rig: {
      root,
      joints,
      setJoint: (j, v) => body.setJoint(j, v),
    },
    head,
    chest,
    gloves: { L: gloves.L as THREE.Object3D, R: gloves.R as THREE.Object3D },
    body,
    dispose() {
      for (const d of ctx.disposables) d.dispose();
      body.dispose();
    },
  };
}
