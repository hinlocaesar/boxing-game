import type { Difficulty, PunchKind, PunchProfile } from "./types";

/* ------------------------------------------------------------------ */
/* Physical world                                                      */
/* ------------------------------------------------------------------ */

export const RING = {
  /** Inner canvas, metres (a touch over 20ft). */
  inner: 6.1,
  apron: 0.55,
  canvasHeight: 0.95,
  postRadius: 0.09,
  ropeHeights: [0.42, 0.78, 1.14, 1.48],
  ropeSag: 0.05,
  ropeRadius: 0.022,
  /** Fighters are kept this far inside the ropes. */
  combatMargin: 0.42,
};

export const FIGHTER = {
  height: 1.82,
  shoulderWidth: 0.44,
  /** Hard cap on how far apart fighters can be pushed. */
  maxSeparation: 2.6,
  minSeparation: 0.62,
  /** Distance at which punches start losing effectiveness. */
  sweetSpot: 1.62,
  maxPunchRange: 2.25,
  /** Base punch reach (shoulder to fist at full extension), metres. */
  baseReach: 1.55,
  moveSpeed: 3.05,
  turnSpeed: 5.2,
  idleStaminaRegen: 10,
  blockStaminaRegen: 15,
  staminaRecoverDelay: 0.55,
};

/* ------------------------------------------------------------------ */
/* Punch table                                                         */
/* ------------------------------------------------------------------ */

export const PUNCHES: Record<PunchKind, PunchProfile> = {
  jab: {
    kind: "jab",
    label: "Jab",
    side: "lead",
    windup: 0.07,
    extend: 0.09,
    recover: 0.16,
    impactAt: 0.62,
    damage: 2.6,
    stamina: 3.4,
    reach: 0.16,
    accuracy: 0.86,
    stun: 2.2,
    bodyWeight: 0.35,
    knockChance: 0.01,
  },
  straight: {
    kind: "straight",
    label: "Straight",
    side: "rear",
    windup: 0.11,
    extend: 0.12,
    recover: 0.24,
    impactAt: 0.6,
    damage: 5.0,
    stamina: 6.4,
    reach: 0.22,
    accuracy: 0.76,
    stun: 5.5,
    bodyWeight: 0.35,
    knockChance: 0.03,
  },
  hook: {
    kind: "hook",
    label: "Hook",
    side: "lead",
    windup: 0.15,
    extend: 0.13,
    recover: 0.3,
    impactAt: 0.58,
    damage: 7.2,
    stamina: 8.2,
    reach: 0.05,
    accuracy: 0.62,
    stun: 9.5,
    bodyWeight: 0.45,
    knockChance: 0.07,
  },
  uppercut: {
    kind: "uppercut",
    label: "Uppercut",
    side: "rear",
    windup: 0.19,
    extend: 0.14,
    recover: 0.36,
    impactAt: 0.56,
    damage: 9.5,
    stamina: 10.5,
    reach: -0.08,
    accuracy: 0.52,
    stun: 14,
    bodyWeight: 0.5,
    knockChance: 0.12,
  },
};

/** Body shots trade damage for stamina destruction and accuracy. */
export const BODY_MODIFIERS = {
  damage: 0.72,
  staminaDamage: 2.6,
  accuracy: 1.12,
  stun: 0.55,
};

/* ------------------------------------------------------------------ */
/* Damage / durability                                                 */
/* ------------------------------------------------------------------ */

export const VITALS = {
  maxHealth: 100,
  maxStamina: 100,
  /** Stun at or above this makes a fighter "rocked". */
  rockedThreshold: 68,
  /** Stun decays at this many points per second. */
  stunDecay: 12,
  /** Below this health a fighter is in danger of going down. */
  dangerHealth: 24,
  /** Seconds of the 10-count the player gets to perform a get-up. */
  getupWindow: 9.5,
  /** Consecutive knockdowns in a round that end the fight. */
  maxKnockdownsPerRound: 3,
};

export const DIFFICULTY_TUNING: Record<
  Difficulty,
  { reaction: number; aggression: number; error: number; guard: number }
> = {
  amateur: { reaction: 0.42, aggression: 0.55, error: 0.3, guard: 0.55 },
  pro: { reaction: 0.26, aggression: 0.72, error: 0.18, guard: 0.72 },
  champion: { reaction: 0.16, aggression: 0.88, error: 0.1, guard: 0.86 },
  legend: { reaction: 0.08, aggression: 1.0, error: 0.04, guard: 0.96 },
};

/* ------------------------------------------------------------------ */
/* Presentation                                                        */
/* ------------------------------------------------------------------ */

export const CAMERA = {
  fov: 50,
  distance: 3.9,
  height: 2.25,
  lookHeight: 1.3,
  /** Sideways offset so the player never occludes the opponent. */
  lateral: 0.55,
  opponentBias: 0.42,
  shakeDecay: 6.5,
  koOrbitSpeed: 0.55,
};

export const COLORS = {
  gold: 0xf7c948,
  canvas: 0x1a2340,
  canvasAccent: 0xd8dbe6,
  apron: 0x0e1424,
  post: 0x8f1d1a,
  rope: 0xe8e3d6,
  crowd: 0x0a0c14,
};
