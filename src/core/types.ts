/**
 * Shared types for Ring of Fire.
 *
 * Coordinate convention (all fighter-local spaces):
 *   +Y = up,  +Z = forward (fighter's nose),  +X = fighter's left.
 *   A limb at rest hangs along -Y from its joint pivot.
 */

export type Joint =
  | "root"
  | "rootPos"
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "shoulderL"
  | "upperArmL"
  | "foreArmL"
  | "handL"
  | "shoulderR"
  | "upperArmR"
  | "foreArmR"
  | "handR"
  | "upperLegL"
  | "lowerLegL"
  | "footL"
  | "upperLegR"
  | "lowerLegR"
  | "footR";

/** [x, y, z] rotation in radians (XYZ order), or translation for "root". */
export type Vec3 = [number, number, number];
export type Pose = Partial<Record<Joint, Vec3>>;

export interface Keyframe {
  /** Normalised 0..1 through the clip. */
  t: number;
  pose: Pose;
  event?: ClipEvent;
}

export type ClipEvent = "throw" | "impact" | "recover";

export interface Clip {
  name: string;
  duration: number;
  loop?: boolean;
  keys: Keyframe[];
}

/* ------------------------------------------------------------------ */
/* Combat                                                              */
/* ------------------------------------------------------------------ */

export type PunchKind = "jab" | "straight" | "hook" | "uppercut";
export type StrikeTarget = "head" | "body";
export type PunchSide = "lead" | "rear";

export interface PunchProfile {
  kind: PunchKind;
  label: string;
  side: PunchSide;
  /** Seconds, before speed scaling. */
  windup: number;
  extend: number;
  recover: number;
  /** Normalised 0..1 time within the clip at which contact is tested. */
  impactAt: number;
  damage: number;
  stamina: number;
  /** Extra reach beyond the fighter's base punch reach, metres. */
  reach: number;
  accuracy: number;
  stun: number;
  /** How much of the damage is redirected to stamina rather than health. */
  bodyWeight: number;
  knockChance: number;
}

export type Stance = "orthodox" | "southpaw";

export type FighterState =
  | "idle"
  | "punching"
  | "blocking"
  | "slip"
  | "hurt"
  | "rocked"
  | "knockdown"
  | "getup"
  | "victory"
  | "defeat";

export type FighterStyle =
  | "Boxer"
  | "Brawler"
  | "Slugger"
  | "Counter-Puncher"
  | "Technician"
  | "All-Rounder";

export interface Attributes {
  power: number;
  speed: number;
  chin: number;
  stamina: number;
  accuracy: number;
  footwork: number;
}

export interface FighterColors {
  skin: number;
  trunks: number;
  trim: number;
  gloves: number;
  hair: number;
  boots: number;
}

export interface AIProfile {
  aggression: number;
  defense: number;
  comboBias: number;
  counterBias: number;
}

export interface FighterProfile {
  id: string;
  name: string;
  nickname: string;
  style: FighterStyle;
  record: string;
  reachNote: string;
  stance: Stance;
  attrs: Attributes;
  colors: FighterColors;
  /** Overall body scale multiplier (0.94 heavy .. 1.06 rangy). */
  bodyScale: number;
  ai: AIProfile;
}

export type Difficulty = "amateur" | "pro" | "champion" | "legend";

export interface MatchSettings {
  playerProfileId: string;
  opponentProfileId: string;
  rounds: number;
  roundSeconds: number;
  difficulty: Difficulty;
  aiRating: number;
  audio: boolean;
}

export type RoundOutcome = "ko" | "tko" | "decision" | "draw" | "dq";

export interface FightTelemetry {
  landed: number;
  thrown: number;
  headLanded: number;
  bodyLanded: number;
  knockdowns: number;
  bestComboRate: number;
}
