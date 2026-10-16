import type { Clip, Joint, Pose, PunchKind, Vec3 } from "./types";
import { PUNCHES } from "./constants";

/* ==================================================================
   Pose helpers
   ================================================================== */

/** Returns a new pose with `over` layered on top of `base`. */
export function mergePose(base: Pose, over: Pose): Pose {
  return { ...base, ...over };
}

const SIDE_FLIP: Partial<Record<Joint, Joint>> = {
  shoulderL: "shoulderR",
  shoulderR: "shoulderL",
  upperArmL: "upperArmR",
  upperArmR: "upperArmL",
  foreArmL: "foreArmR",
  foreArmR: "foreArmL",
  handL: "handR",
  handR: "handL",
  upperLegL: "upperLegR",
  upperLegR: "upperLegL",
  lowerLegL: "lowerLegR",
  lowerLegR: "lowerLegL",
  footL: "footR",
  footR: "footL",
};

/**
 * Mirrors a pose across the fighter's sagittal plane so an orthodox clip can
 * be reused by a southpaw. Mirroring negates the Y and Z rotation components
 * and swaps the left/right limbs.
 */
export function mirrorPose(pose: Pose): Pose {
  const out: Pose = {};
  for (const key of Object.keys(pose) as Joint[]) {
    const v = pose[key] as Vec3;
    const target = SIDE_FLIP[key] ?? key;
    if (key === "rootPos") {
      out[target] = [-v[0], v[1], v[2]];
    } else {
      out[target] = [v[0], -v[1], -v[2]];
    }
  }
  return out;
}

/** Convenience: blend two poses. */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = {};
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = (a[k as Joint] as Vec3) ?? ZERO;
    const bv = (b[k as Joint] as Vec3) ?? ZERO;
    out[k as Joint] = [
      av[0] + (bv[0] - av[0]) * t,
      av[1] + (bv[1] - av[1]) * t,
      av[2] + (bv[2] - av[2]) * t,
    ];
  }
  return out;
}

const ZERO: Vec3 = [0, 0, 0];

/* ==================================================================
   Static poses (orthodox base; mirror for southpaw)
   ================================================================== */

/** Everything at zero = relaxed A-pose with limbs hanging straight down. */
export const REST_POSE: Pose = {};

/** Textbook orthodox guard with the lead (left) foot forward. */
export const GUARD_POSE: Pose = {
  root: [0, 0, 0],
  rootPos: [0, 0, 0],
  hips: [-0.04, -0.3, 0],
  spine: [0.06, 0.12, 0],
  chest: [0.03, 0.08, 0],
  neck: [-0.02, 0, 0],
  head: [-0.05, 0.06, 0],

  shoulderL: [-0.12, 0, 0.08],
  upperArmL: [-0.62, -0.1, 0.34],
  foreArmL: [-1.62, 0, 0],
  handL: [0.1, 0, 0],

  shoulderR: [-0.12, 0, -0.08],
  upperArmR: [-0.55, 0.1, -0.3],
  foreArmR: [-1.72, 0, 0],
  handR: [0.1, 0, 0],

  upperLegL: [-0.26, 0.06, 0.09],
  lowerLegL: [0.4, 0, 0],
  footL: [0.05, 0, 0],

  upperLegR: [0.16, -0.06, -0.13],
  lowerLegR: [0.46, 0, 0],
  footR: [0.3, 0, 0],
};

export const BLOCK_POSE: Pose = mergePose(GUARD_POSE, {
  rootPos: [0, -0.05, 0],
  chest: [0.14, 0.02, 0],
  neck: [0.04, 0, 0],
  head: [0.1, 0.02, 0],
  shoulderL: [-0.3, 0, 0.1],
  shoulderR: [-0.3, 0, -0.1],
  upperArmL: [-1.02, 0, 0.3],
  foreArmL: [-2.06, 0, 0],
  upperArmR: [-1.02, 0, -0.3],
  foreArmR: [-2.06, 0, 0],
  upperLegL: [-0.34, 0.06, 0.09],
  lowerLegL: [0.5, 0, 0],
  upperLegR: [0.22, -0.06, -0.13],
  lowerLegR: [0.56, 0, 0],
});

export const HURT_POSE: Pose = mergePose(GUARD_POSE, {
  rootPos: [0, -0.02, -0.05],
  spine: [-0.06, 0.1, 0],
  chest: [-0.08, 0.04, 0],
  neck: [-0.22, 0, 0],
  head: [-0.34, 0.1, 0],
  upperArmL: [-0.34, 0, 0.56],
  foreArmL: [-1.18, 0, 0],
  upperArmR: [-0.3, 0, -0.5],
  foreArmR: [-1.24, 0, 0],
  upperLegR: [0.3, -0.06, -0.14],
  lowerLegR: [0.55, 0, 0],
});

export const ROCKED_POSE: Pose = mergePose(GUARD_POSE, {
  rootPos: [0, -0.05, -0.1],
  spine: [-0.1, 0.12, 0],
  chest: [-0.14, 0.06, 0],
  neck: [-0.3, 0.05, 0],
  head: [-0.44, 0.14, 0],
  upperArmL: [0.06, 0, 0.72],
  foreArmL: [-0.86, 0, 0],
  upperArmR: [0.02, 0, -0.66],
  foreArmR: [-0.9, 0, 0],
  upperLegL: [-0.16, 0.12, 0.2],
  lowerLegL: [0.56, 0, 0],
  upperLegR: [0.1, -0.14, -0.22],
  lowerLegR: [0.62, 0, 0],
});

/** Weight-forward slip used to evade. Mirrored for the other side. */
export const SLIP_LEFT_POSE: Pose = mergePose(GUARD_POSE, {
  root: [0, 0, -0.26],
  rootPos: [0.05, -0.04, 0.03],
  chest: [0.06, 0.16, 0],
  neck: [0.02, 0.1, 0],
  head: [0.06, 0.12, 0],
  upperLegL: [-0.2, 0.1, 0.24],
  upperLegR: [0.22, -0.08, -0.26],
});

export const SLIP_RIGHT_POSE: Pose = mirrorPose(SLIP_LEFT_POSE);

export const LEAN_BACK_POSE: Pose = mergePose(GUARD_POSE, {
  root: [-0.2, 0, 0],
  rootPos: [0, -0.02, -0.09],
  chest: [-0.1, 0.04, 0],
  neck: [-0.1, 0, 0],
  head: [-0.16, 0.04, 0],
  upperLegL: [-0.36, 0.06, 0.1],
  lowerLegL: [0.46, 0, 0],
  upperLegR: [-0.1, -0.06, -0.14],
  lowerLegR: [0.5, 0, 0],
  footR: [0.5, 0, 0],
});

export const VICTORY_POSE: Pose = mergePose(GUARD_POSE, {
  rootPos: [0, 0.02, 0],
  chest: [-0.08, 0, 0],
  head: [-0.16, 0, 0],
  shoulderL: [-0.4, 0, 0.2],
  shoulderR: [-0.4, 0, -0.2],
  upperArmL: [-2.2, -0.2, 0.5],
  foreArmL: [-0.55, 0, 0],
  upperArmR: [-2.2, 0.2, -0.5],
  foreArmR: [-0.55, 0, 0],
});

export const DEFEAT_POSE: Pose = mergePose(GUARD_POSE, {
  rootPos: [0, -0.14, 0],
  hips: [0.1, -0.12, 0],
  spine: [0.44, 0.04, 0],
  chest: [0.24, 0, 0],
  neck: [0.1, 0, 0],
  head: [0.36, 0, 0],
  upperArmL: [-0.2, 0, 0.52],
  foreArmL: [-0.28, 0, 0],
  upperArmR: [-0.2, 0, -0.52],
  foreArmR: [-0.28, 0, 0],
  upperLegL: [-0.36, 0.1, 0.1],
  lowerLegL: [0.62, 0, 0],
  upperLegR: [0.34, -0.1, -0.12],
  lowerLegR: [0.66, 0, 0],
});

/* ==================================================================
   Punch clips — built for an orthodox fighter, mirrored for southpaw
   ================================================================== */

const JAB_WINDUP: Pose = mergePose(GUARD_POSE, {
  upperArmL: [-0.72, -0.1, 0.4],
  foreArmL: [-1.82, 0, 0],
  chest: [0.02, 0.18, 0],
  hips: [-0.04, -0.36, 0],
});

const JAB_EXTEND: Pose = mergePose(GUARD_POSE, {
  shoulderL: [-0.22, 0, 0.02],
  upperArmL: [-1.44, 0, 0.1],
  foreArmL: [-0.32, 0, 0],
  handL: [0.04, 0, 0],
  chest: [0.04, -0.1, 0],
  hips: [-0.05, -0.44, 0],
  head: [-0.04, -0.02, 0],
});

const STRAIGHT_WINDUP: Pose = mergePose(GUARD_POSE, {
  upperArmR: [-0.34, 0.1, -0.3],
  foreArmR: [-1.96, 0, 0],
  chest: [0.03, 0.02, 0],
  hips: [-0.04, -0.42, 0],
});

const STRAIGHT_EXTEND: Pose = mergePose(GUARD_POSE, {
  shoulderR: [-0.24, 0, -0.02],
  upperArmR: [-1.48, 0, -0.06],
  foreArmR: [-0.28, 0, 0],
  handR: [0.04, 0, 0],
  hips: [-0.05, 0.12, 0],
  chest: [0.05, 0.28, 0],
  head: [-0.04, 0.16, 0],
  upperLegR: [-0.08, -0.06, -0.1],
  lowerLegR: [0.5, 0, 0],
  footR: [0.52, 0, 0],
});

const HOOK_WINDUP: Pose = mergePose(GUARD_POSE, {
  upperArmL: [-0.72, -0.2, 0.96],
  foreArmL: [-1.86, 0, 0],
  chest: [0.02, 0.26, 0],
  hips: [-0.04, -0.54, 0],
  rootPos: [0.03, 0, 0],
});

const HOOK_EXTEND: Pose = mergePose(GUARD_POSE, {
  shoulderL: [-0.24, 0, 0.1],
  upperArmL: [-1.24, -0.3, 0.42],
  foreArmL: [-1.54, 0, 0],
  handL: [0, 0, 0.2],
  chest: [0.04, -0.24, 0],
  hips: [-0.05, 0.08, 0],
  head: [-0.05, -0.06, 0],
  upperLegR: [-0.04, -0.06, -0.12],
});

const UPPER_WINDUP: Pose = mergePose(GUARD_POSE, {
  rootPos: [0, -0.08, 0],
  upperArmR: [-0.08, 0.1, -0.36],
  foreArmR: [-2.06, 0, 0],
  handR: [0.2, 0, 0],
  chest: [0.1, 0.04, 0],
  hips: [-0.06, -0.46, 0],
  upperLegL: [-0.34, 0.06, 0.09],
  lowerLegL: [0.54, 0, 0],
  upperLegR: [0.26, -0.06, -0.13],
  lowerLegR: [0.62, 0, 0],
});

const UPPER_EXTEND: Pose = mergePose(GUARD_POSE, {
  rootPos: [0, 0.05, 0.04],
  shoulderR: [-0.18, 0, -0.06],
  upperArmR: [-1.04, 0.1, -0.28],
  foreArmR: [-1.34, 0, 0],
  handR: [0.1, 0, 0],
  chest: [0.02, 0.12, 0],
  hips: [-0.02, 0.04, 0],
  head: [-0.12, 0.06, 0],
  upperLegR: [0.0, -0.06, -0.12],
  lowerLegR: [0.34, 0, 0],
  footR: [0.52, 0, 0],
});

const PUNCH_POSES: Record<PunchKind, { windup: Pose; extend: Pose }> = {
  jab: { windup: JAB_WINDUP, extend: JAB_EXTEND },
  straight: { windup: STRAIGHT_WINDUP, extend: STRAIGHT_EXTEND },
  hook: { windup: HOOK_WINDUP, extend: HOOK_EXTEND },
  uppercut: { windup: UPPER_WINDUP, extend: UPPER_EXTEND },
};

/**
 * Builds a punch clip. `speed` is the fighter's speed attribute (1 = baseline);
 * higher values compress the clip so punches look snappier.
 */
export function buildPunchClip(kind: PunchKind, speed: number, stance: "orthodox" | "southpaw"): Clip {
  const prof = PUNCHES[kind];
  const s = Math.max(0.6, Math.min(1.6, speed));
  const w = prof.windup / s;
  const e = prof.extend / s;
  const r = prof.recover / s;
  const d = Math.max(0.12, w + e + r);
  const poses = PUNCH_POSES[kind];

  let keys = [
    { t: 0, pose: GUARD_POSE },
    { t: w / d, pose: poses.windup },
    { t: (w + e) / d, pose: poses.extend, event: "impact" as const },
    { t: 1, pose: GUARD_POSE },
  ];
  let guard = GUARD_POSE;

  if (stance === "southpaw") {
    keys = keys.map((k) => ({ ...k, pose: mirrorPose(k.pose) }));
    guard = mirrorPose(GUARD_POSE);
  }
  void guard;

  return { name: `punch_${kind}`, duration: d, keys };
}

/* ==================================================================
   Reaction / transition clips
   ================================================================== */

/** Mirrors every keyframe of a clip (used to reuse orthodox clips as southpaw). */
export function mirrorClip(clip: Clip): Clip {
  return {
    ...clip,
    keys: clip.keys.map((k) => ({ ...k, pose: mirrorPose(k.pose) })),
  };
}

export function buildKnockdownClip(impactFrom: number): Clip {
  const dir = Math.sign(impactFrom) || 1;
  return {
    name: "knockdown",
    duration: 1.25,
    keys: [
      { t: 0, pose: GUARD_POSE },
      { t: 0.14, pose: ROCKED_POSE },
      {
        t: 0.42,
        pose: {
          root: [-0.55, 0.04 * dir, 0.06 * dir],
          rootPos: [0.02 * dir, 0.02, 0],
          spine: [-0.14, 0.1, -0.1 * dir],
          chest: [-0.16, 0.06, -0.12 * dir],
          neck: [-0.2, 0, 0],
          head: [-0.3, 0.1, -0.1 * dir],
          shoulderL: [-0.3, 0, 0.3],
          shoulderR: [-0.3, 0, -0.3],
          upperArmL: [-0.4, 0, 1.0],
          foreArmL: [-0.7, 0, 0],
          upperArmR: [-0.4, 0, -1.0],
          foreArmR: [-0.7, 0, 0],
          upperLegL: [-0.7, 0.1, 0.12],
          lowerLegL: [0.8, 0, 0],
          upperLegR: [-0.4, -0.1, -0.16],
          lowerLegR: [0.7, 0, 0],
        },
      },
      {
        t: 0.72,
        pose: {
          root: [-1.32, 0.05 * dir, 0.02 * dir],
          rootPos: [0.03 * dir, 0.0, 0],
          spine: [-0.05, 0.05, 0],
          chest: [-0.05, 0.03, 0],
          neck: [0.1, 0, 0],
          head: [0.16, 0.05, 0],
          upperArmL: [-0.5, 0, 1.15],
          foreArmL: [-0.5, 0, 0],
          upperArmR: [-0.5, 0, -1.15],
          foreArmR: [-0.5, 0, 0],
          upperLegL: [-0.5, 0.06, 0.1],
          lowerLegL: [0.4, 0, 0],
          upperLegR: [-0.5, -0.06, -0.12],
          lowerLegR: [0.35, 0, 0],
        },
      },
      {
        t: 1,
        pose: {
          root: [-1.5, 0.06 * dir, 0],
          rootPos: [0.04 * dir, 0, 0],
          spine: [0.02, 0.04, 0],
          chest: [0.02, 0.02, 0],
          neck: [0.14, 0, 0],
          head: [0.2, 0, 0.05 * dir],
          upperArmL: [-0.55, 0, 1.2],
          foreArmL: [-0.42, 0, 0],
          upperArmR: [-0.55, 0, -1.2],
          foreArmR: [-0.42, 0, 0],
          upperLegL: [-0.42, 0.06, 0.1],
          lowerLegL: [0.3, 0, 0],
          upperLegR: [-0.6, -0.06, -0.12],
          lowerLegR: [0.5, 0, 0],
        },
      },
    ],
  };
}

export function buildGetupClip(): Clip {
  const lying = buildKnockdownClip(1).keys[3].pose;
  return {
    name: "getup",
    duration: 1.5,
    keys: [
      { t: 0, pose: lying },
      {
        t: 0.4,
        pose: {
          root: [-0.7, 0.02, 0],
          rootPos: [0, 0.0, 0],
          spine: [0.3, 0, 0],
          chest: [0.2, 0, 0],
          neck: [0.15, 0, 0],
          head: [0.2, 0, 0],
          upperArmL: [-0.4, 0, 0.9],
          foreArmL: [-0.9, 0, 0],
          upperArmR: [-0.4, 0, -0.9],
          foreArmR: [-0.9, 0, 0],
          upperLegL: [-1.0, 0.1, 0.14],
          lowerLegL: [1.2, 0, 0],
          upperLegR: [-0.7, -0.1, -0.16],
          lowerLegR: [1.0, 0, 0],
        },
      },
      {
        t: 0.75,
        pose: mergePose(GUARD_POSE, {
          root: [-0.14, 0, 0],
          rootPos: [0, -0.2, -0.04],
          spine: [0.2, 0.08, 0],
          chest: [0.14, 0.04, 0],
          upperArmL: [-0.5, 0, 0.5],
          foreArmL: [-1.1, 0, 0],
          upperArmR: [-0.5, 0, -0.5],
          foreArmR: [-1.1, 0, 0],
          upperLegL: [-0.8, 0.06, 0.1],
          lowerLegL: [1.0, 0, 0],
          upperLegR: [0.0, -0.06, -0.13],
          lowerLegR: [0.8, 0, 0],
        }),
      },
      { t: 1, pose: GUARD_POSE },
    ],
  };
}

export const SLIP_CLIP: Clip = {
  name: "slip",
  duration: 0.34,
  keys: [
    { t: 0, pose: GUARD_POSE },
    { t: 0.35, pose: SLIP_LEFT_POSE },
    { t: 0.7, pose: SLIP_LEFT_POSE },
    { t: 1, pose: GUARD_POSE },
  ],
};

export const LEAN_CLIP: Clip = {
  name: "lean",
  duration: 0.36,
  keys: [
    { t: 0, pose: GUARD_POSE },
    { t: 0.35, pose: LEAN_BACK_POSE },
    { t: 0.7, pose: LEAN_BACK_POSE },
    { t: 1, pose: GUARD_POSE },
  ],
};
