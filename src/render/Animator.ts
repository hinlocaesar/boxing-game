import type * as THREE from "three";
import type { Clip, ClipEvent, Joint, Pose, Vec3 } from "../core/types";
import { GUARD_POSE, lerpPose, mergePose } from "../core/poses";

const ZERO: Vec3 = [0, 0, 0];

const JOINTS: Joint[] = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "shoulderL",
  "upperArmL",
  "foreArmL",
  "handL",
  "shoulderR",
  "upperArmR",
  "foreArmR",
  "handR",
  "upperLegL",
  "lowerLegL",
  "footL",
  "upperLegR",
  "lowerLegR",
  "footR",
];

export interface Rig {
  root: THREE.Object3D;
  joints: Partial<Record<Joint, THREE.Object3D>>;
  /**
   * Optional override for one joint's rotation. Returning `true` claims the
   * joint, which lets a rig drive a foreign skeleton (see `BoxerBody`) while
   * the pose data stays in plain Euler angles.
   */
  setJoint?: (joint: Joint, euler: Vec3) => boolean;
}

interface PlayOptions {
  speed?: number;
  /** Hold the final pose instead of returning to base. */
  hold?: boolean;
  /** Crossfade time from the current pose, seconds. */
  fade?: number;
}

/** Smooths a value towards a target with an exponential curve. */
function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export class Animator {
  /** The pose the fighter settles into (guard, block, hurt, ...). */
  private base: Pose = { ...GUARD_POSE };
  private baseTarget: Pose = { ...GUARD_POSE };

  private clip: Clip | null = null;
  private clipTime = 0;
  private clipSpeed = 1;
  private holdLast = false;
  private firedEvents = new Set<number>();

  /** Ongoing crossfade from a previously evaluated pose. */
  private outgoing: Pose | null = null;
  private fadeT = 0;
  private fadeDur = 0;

  /** Procedural motion drivers. */
  time = Math.random() * 10;
  breathAmp = 1;
  bounceAmp = 0;
  swayAmp = 0;
  wobbleAmp = 0;
  guardTightness = 0;

  /** Footwork. */
  strideAmp = 0;
  /** Ground the body covers in one step, metres. */
  private stepLen = 0.68;
  private stridePhase = 0;
  private strideX = 0;
  private strideZ = 0;
  private impulse = 0;
  private impulseDecay = 7;

  onEvent: ((e: ClipEvent) => void) | null = null;

  /* ---------------------------------------------------------------- */

  setBase(pose: Pose, fadeSeconds = 0.16): void {
    if (pose === this.baseTarget) return;
    this.baseTarget = pose;
    this.fadeDur = fadeSeconds;
    this.fadeT = 0;
    this.outgoing = this.evaluateStatic();
  }

  play(clip: Clip, opts: PlayOptions = {}): void {
    if (!clip.keys.length) return;
    this.outgoing = this.evaluateStatic();
    this.fadeT = 0;
    this.fadeDur = opts.fade ?? 0.07;
    this.clip = clip;
    this.clipTime = 0;
    this.clipSpeed = opts.speed ?? 1;
    this.holdLast = !!opts.hold;
    this.firedEvents.clear();
  }

  stop(): void {
    this.clip = null;
  }

  get busy(): boolean {
    return this.clip !== null;
  }

  get clipName(): string | null {
    return this.clip?.name ?? null;
  }

  /** Normalised progress through the current clip, 0..1. */
  get clipProgress(): number {
    if (!this.clip) return 0;
    return Math.min(1, this.clipTime / this.clip.duration);
  }

  /** Kicks an instantaneous wobble, used on impact. */
  kick(amount: number): void {
    this.impulse += amount;
  }

  /**
   * Feeds the footwork layer the distance the body actually covered this frame,
   * in the fighter's own frame (x = left, z = forward). The step cycle is driven
   * by distance rather than by time, so a planted foot holds its spot on the
   * canvas while the other one swings past it — no skating.
   */
  locomotion(dx: number, dz: number, dt: number): void {
    const dist = Math.hypot(dx, dz);
    const speed = dist / Math.max(1e-4, dt);
    // Past the first bound is a teleport (corner reset); under the second is the
    // shuffle of two fighters leaning on each other, which is not a step.
    const moving = dist < 0.15 && speed > 0.3;
    if (moving) {
      this.strideX = dx / dist;
      this.strideZ = dz / dist;
      this.stridePhase += dist / this.stepLen;
      this.stridePhase -= Math.floor(this.stridePhase);
    }
    this.strideAmp += ((moving ? 1 : 0) - this.strideAmp) * Math.min(1, dt * 9);
  }

  /* ---------------------------------------------------------------- */

  private sampleClip(clip: Clip, time: number): Pose {
    const { keys } = clip;
    const n = keys.length;
    if (time <= 0) return keys[0].pose;
    if (time >= clip.duration) return keys[n - 1].pose;

    let i = 0;
    while (i < n - 2 && time > keys[i + 1].t * clip.duration) i++;
    const a = keys[i];
    const b = keys[Math.min(i + 1, n - 1)];
    const ta = a.t * clip.duration;
    const tb = b.t * clip.duration;
    const span = Math.max(1e-5, tb - ta);
    const raw = Math.min(1, Math.max(0, (time - ta) / span));
    const blend = easeInOut(raw);

    // Layer b onto a so both keys' channels are honoured.
    const merged = mergePose(a.pose, b.pose);
    const out: Pose = {};
    for (const k of Object.keys(merged) as Joint[]) {
      const av = (a.pose[k] as Vec3) ?? ZERO;
      const bv = (b.pose[k] as Vec3) ?? ZERO;
      out[k] = [
        av[0] + (bv[0] - av[0]) * blend,
        av[1] + (bv[1] - av[1]) * blend,
        av[2] + (bv[2] - av[2]) * blend,
      ];
    }
    return out;
  }

  private evaluateStatic(): Pose {
    if (!this.clip) return { ...this.base };
    return this.sampleClip(this.clip, this.clipTime);
  }

  /** Produces the full pose for this frame. */
  evaluate(dt: number): Pose {
    // 1. Advance the base pose towards its target.
    if (this.fadeT < this.fadeDur) {
      this.fadeT += dt;
      const t = easeInOut(Math.min(1, this.fadeT / this.fadeDur));
      this.base = lerpPose(this.base, this.baseTarget, t);
    } else {
      this.base = { ...this.baseTarget };
    }

    // 2. Advance the active clip.
    let core: Pose;
    if (this.clip) {
      const prevTime = this.clipTime;
      this.clipTime += dt * this.clipSpeed;
      for (let i = 0; i < this.clip.keys.length; i++) {
        const k = this.clip.keys[i];
        if (k.event && !this.firedEvents.has(i)) {
          const at = k.t * this.clip.duration;
          if (prevTime <= at && this.clipTime >= at) {
            this.firedEvents.add(i);
            this.onEvent?.(k.event);
          }
        }
      }
      if (this.clipTime >= this.clip.duration) {
        if (this.holdLast) {
          this.clipTime = this.clip.duration;
          core = this.sampleClip(this.clip, this.clipTime);
        } else {
          this.clip = null;
          core = { ...this.base };
        }
      } else {
        core = this.sampleClip(this.clip, this.clipTime);
      }
    } else {
      core = { ...this.base };
    }

    // 3. Crossfade from the outgoing pose.
    if (this.outgoing && this.fadeDur > 0 && this.fadeT < this.fadeDur) {
      const t = easeInOut(Math.min(1, this.fadeT / this.fadeDur));
      core = lerpPose(this.outgoing, core, t);
    } else {
      this.outgoing = null;
    }

    // 4. Layer procedural motion.
    this.time += dt;
    return this.addProcedural(core, dt);
  }

  private addProcedural(pose: Pose, dt: number): Pose {
    const out: Pose = { ...pose };
    const t = this.time;
    const add = (joint: Joint, x: number, y: number, z: number) => {
      const src = out[joint];
      const v: Vec3 = src ? [src[0], src[1], src[2]] : [0, 0, 0];
      v[0] += x;
      v[1] += y;
      v[2] += z;
      out[joint] = v;
    };

    // Breathing.
    const breath = Math.sin(t * 1.7) * this.breathAmp;
    const rpSrc = out.rootPos;
    const bv: Vec3 = rpSrc ? [rpSrc[0], rpSrc[1], rpSrc[2]] : [0, 0, 0];
    bv[1] += breath * 0.008;
    bv[2] += Math.sin(t * 1.7 + 0.4) * 0.004 * this.breathAmp;
    out.rootPos = bv;

    add("chest", Math.sin(t * 1.7) * 0.012 * this.breathAmp, 0, 0);

    // Footwork bounce. Fades out once the step cycle below carries the motion,
    // so the two rhythms don't fight each other.
    if (this.bounceAmp > 0.001) {
      const b = Math.abs(Math.sin(t * 7.4)) * this.bounceAmp * (1 - 0.7 * this.strideAmp);
      const rp = out.rootPos as Vec3;
      rp[1] += b * 0.035;
      add("upperLegL", -b * 0.12, 0, 0);
      add("upperLegR", -b * 0.1, 0, 0);
      add("lowerLegL", b * 0.2, 0, 0);
      add("lowerLegR", b * 0.18, 0, 0);
    }

    // Footwork: a step cycle. Each foot holds station for the stance half (the
    // hip rotation back through it is exactly the body's own travel, so it stays
    // put on the canvas) and then swings forward, knee lifted, to overtake.
    if (this.strideAmp > 0.002) {
      const amp = this.strideAmp;
      const dx = this.strideX;
      const dz = this.strideZ;
      const STANCE = 0.6;
      const PLANT = 0.3; // ground the foot covers per step, as a share of stepLen
      const REACH = 0.8; // hip-to-ankle length, metres
      const LIFT = 0.3; // peak knee lift, radians

      for (let i = 0; i < 2; i++) {
        let u = this.stridePhase + i * 0.5;
        u -= Math.floor(u);
        let s: number;
        let lift: number;
        if (u < STANCE) {
          s = PLANT * (1 - (2 * u) / STANCE);
          lift = 0;
        } else {
          const t = (u - STANCE) / (1 - STANCE);
          s = PLANT * (2 * t - 1);
          lift = Math.sin(Math.PI * t);
        }
        const knee = lift * LIFT * amp;
        const step = (s * amp * this.stepLen) / (REACH * Math.cos(knee));
        // The knee lift cancels its own forward drift, so the foot lands under
        // the hip rather than kicking out. The toe is tipped up while airborne,
        // or the boot reads as a pointed toe.
        const side: "L" | "R" = i === 0 ? "L" : "R";
        add(`upperLeg${side}`, -step * dz - knee, 0, step * dx);
        add(`lowerLeg${side}`, knee * 2, 0, 0);
        add(`foot${side}`, (step * dz - knee) * 0.8 - lift * 0.5 * amp, 0, 0);
      }
    }

    // Idle sway (weight shifting between feet).
    if (this.swayAmp > 0.001) {
      const s = Math.sin(t * 0.9) * this.swayAmp;
      const rp = out.rootPos as Vec3;
      rp[0] += s * 0.02;
      add("hips", 0, s * 0.05, s * 0.02);
      add("upperLegL", 0, 0, s * 0.05);
      add("upperLegR", 0, 0, s * 0.05);
    }

    // Wobble when hurt / rocked.
    if (this.wobbleAmp > 0.001) {
      const w = Math.sin(t * 9.3) * this.wobbleAmp;
      const w2 = Math.cos(t * 7.1) * this.wobbleAmp;
      add("spine", 0, w * 0.09, w2 * 0.07);
      add("head", 0, w * 0.16, w2 * 0.12);
    }

    // Impact impulse (recoil kick).
    if (this.impulse > 0.0005) {
      const p = this.impulse;
      add("spine", -p * 0.35, 0, 0);
      add("head", -p * 0.5, 0, 0);
      add("neck", -p * 0.3, 0, 0);
      this.impulse = damp(this.impulse, 0, this.impulseDecay, dt);
    } else {
      this.impulse = 0;
    }

    // Tight guard: pull gloves up closer when blocking.
    if (this.guardTightness > 0.001) {
      const g = this.guardTightness;
      add("foreArmL", -0.2 * g, 0, 0);
      add("foreArmR", -0.2 * g, 0, 0);
      add("shoulderL", -0.1 * g, 0, 0);
      add("shoulderR", -0.1 * g, 0, 0);
      add("chest", 0.08 * g, 0, 0);
    }

    return out;
  }

  /** Writes an evaluated pose onto a rig. */
  static apply(rig: Rig, pose: Pose): void {
    const rootRot = pose.root ?? ZERO;
    const rootPos = pose.rootPos ?? ZERO;
    rig.root.rotation.set(rootRot[0], rootRot[1], rootRot[2]);
    rig.root.position.set(rootPos[0], rootPos[1], rootPos[2]);

    for (const j of JOINTS) {
      const v = pose[j] ?? ZERO;
      const obj = rig.joints[j];
      if (obj) obj.rotation.set(v[0], v[1], v[2]);
      // A rig may additionally mirror the rotation onto a foreign skeleton;
      // the local joint still ticks over so its children stay in place.
      rig.setJoint?.(j, v);
    }
  }
}

export { JOINTS };
