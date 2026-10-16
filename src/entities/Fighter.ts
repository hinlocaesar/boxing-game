import * as THREE from "three";
import { buildFighter, type FighterModel } from "../render/FighterModel";
import { createBoxer, type BoxerTemplate } from "../render/BoxerBody";
import { Animator } from "../render/Animator";
import {
  BLOCK_POSE,
  buildGetupClip,
  buildKnockdownClip,
  buildPunchClip,
  DEFEAT_POSE,
  GUARD_POSE,
  HURT_POSE,
  LEAN_BACK_POSE,
  LEAN_CLIP,
  mirrorClip,
  mirrorPose,
  ROCKED_POSE,
  SLIP_LEFT_POSE,
  SLIP_RIGHT_POSE,
  VICTORY_POSE,
} from "../core/poses";
import { FIGHTER, PUNCHES, VITALS } from "../core/constants";
import type {
  Clip,
  FighterProfile,
  FighterState,
  PunchKind,
  PunchProfile,
  StrikeTarget,
} from "../core/types";
import type { AudioEngine } from "../audio/AudioEngine";

/** Floor-to-crown height every downloaded body is fitted to. */
const MODEL_HEIGHT = 1.84;

/** Gentle multiply tint so the roster reads as different skin tones. */
function skinTint(hex: number): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, Math.min(0.22, hsl.s * 0.3), 0.62 + 0.45 * hsl.l);
}

export interface ActivePunch {
  kind: PunchKind;
  target: StrikeTarget;
  profile: PunchProfile;
  resolved: boolean;
}

export interface MotionIntent {
  moveX: number;
  moveZ: number;
  block: boolean;
  slip: number;
  lean: boolean;
}

export interface FighterEvents {
  impact?: (f: Fighter, punch: ActivePunch) => void;
  stateChanged?: (f: Fighter, prev: FighterState, next: FighterState) => void;
  knockdown?: (f: Fighter) => void;
  getupStarted?: (f: Fighter) => void;
}

export interface HitContext {
  target: StrikeTarget;
  stun: number;
  fromDir: number;
  blocked: boolean;
  parried: boolean;
}

export class Fighter {
  readonly profile: FighterProfile;
  readonly team: 0 | 1;
  readonly container = new THREE.Group();
  readonly model: FighterModel;
  readonly animator = new Animator();
  readonly events: FighterEvents = {};

  readonly pos = new THREE.Vector3();
  yaw = 0;
  bound = 3;
  /** Height of the canvas the fighter stands on. */
  groundY = 0;
  /** Radius used for fighter-vs-fighter separation. */
  readonly bodyRadius = 0.42;

  state: FighterState = "idle";
  health = VITALS.maxHealth;
  stamina = VITALS.maxStamina;
  stun = 0;
  downed = false;
  knockedOut = false;
  /** Seconds the current block has been held (used for parry timing). */
  blockElapsed = 0;

  intent: MotionIntent = { moveX: 0, moveZ: 0, block: false, slip: 0, lean: false };

  /* telemetry */
  thrown = 0;
  landed = 0;
  headLanded = 0;
  bodyLanded = 0;
  knockCount = 0;
  knockTotal = 0;
  combo = 0;
  comboRate = 0;
  /** Damage dealt this round / total, used by the judges. */
  roundDamage = 0;
  totalDamage = 0;

  private stance: "orthodox" | "southpaw";
  private P: Record<string, ReturnType<typeof mirrorPose>>;
  private clips: Record<string, Clip> = {};
  private hurtTimer = 0;
  private slipCooldown = 0;
  private leanCooldown = 0;
  private slipInvuln = 0;
  private regenDelay = 0;
  private comboTimer = 0;
  private lungeX = 0;
  private lungeZ = 0;
  private lastBase: unknown = null;
  private audio: AudioEngine;

  constructor(profile: FighterProfile, team: 0 | 1, audio: AudioEngine, boxer: BoxerTemplate) {
    this.profile = profile;
    this.team = team;
    this.audio = audio;
    this.stance = profile.stance;

    this.model = buildFighter(
      profile,
      createBoxer(boxer, MODEL_HEIGHT, skinTint(profile.colors.skin)),
    );
    this.container.add(this.model.root);

    const M = (p: typeof GUARD_POSE) => (this.stance === "southpaw" ? mirrorPose(p) : p);
    this.P = {
      guard: M(GUARD_POSE),
      block: M(BLOCK_POSE),
      hurt: M(HURT_POSE),
      rocked: M(ROCKED_POSE),
      slipL: M(SLIP_LEFT_POSE),
      slipR: M(SLIP_RIGHT_POSE),
      lean: M(LEAN_BACK_POSE),
      victory: M(VICTORY_POSE),
      defeat: M(DEFEAT_POSE),
    };

    const mirrorIf = (c: Clip) => (this.stance === "southpaw" ? mirrorClip(c) : c);
    const speed = profile.attrs.speed;
    for (const kind of ["jab", "straight", "hook", "uppercut"] as PunchKind[]) {
      this.clips[`punch_${kind}`] = buildPunchClip(kind, speed, this.stance);
    }
    this.clips.slipL = mirrorIf({
      name: "slipL",
      duration: 0.34,
      keys: [
        { t: 0, pose: GUARD_POSE },
        { t: 0.35, pose: SLIP_LEFT_POSE },
        { t: 0.7, pose: SLIP_LEFT_POSE },
        { t: 1, pose: GUARD_POSE },
      ],
    });
    this.clips.slipR = mirrorIf({
      name: "slipR",
      duration: 0.34,
      keys: [
        { t: 0, pose: GUARD_POSE },
        { t: 0.35, pose: SLIP_RIGHT_POSE },
        { t: 0.7, pose: SLIP_RIGHT_POSE },
        { t: 1, pose: GUARD_POSE },
      ],
    });
    this.clips.lean = mirrorIf(LEAN_CLIP);
    this.clips.victory = mirrorIf({
      name: "victory",
      duration: 1.6,
      loop: true,
      keys: [
        { t: 0, pose: GUARD_POSE },
        { t: 0.3, pose: VICTORY_POSE },
        { t: 0.6, pose: VICTORY_POSE },
        { t: 1, pose: GUARD_POSE },
      ],
    });

    this.animator.onEvent = (e) => {
      if (e === "impact" && this.activePunch) {
        this.events.impact?.(this, this.activePunch);
      }
    };

    this.animator.setBase(this.P.guard, 0);
  }

  activePunch: ActivePunch | null = null;

  /* ================================================================ */

  place(x: number, z: number, facing: number): void {
    this.pos.set(x, 0, z);
    this.yaw = facing;
    this.container.position.set(x, this.groundY, z);
    this.container.rotation.y = facing;
  }

  reset(x: number, z: number, facing: number): void {
    this.place(x, z, facing);
    this.health = VITALS.maxHealth;
    this.stamina = VITALS.maxStamina;
    this.stun = 0;
    this.downed = false;
    this.knockedOut = false;
    this.activePunch = null;
    this.hurtTimer = 0;
    this.regenDelay = 0;
    this.lungeX = this.lungeZ = 0;
    this.animator.stop();
    this.setState("idle");
    this.animator.setBase(this.P.guard, 0);
  }

  resetRound(): void {
    this.stamina = Math.min(VITALS.maxStamina, this.stamina + 35);
    // A minute on the stool buys back some of the damage.
    this.health = Math.min(VITALS.maxHealth, this.health + 18);
    this.stun *= 0.35;
    this.roundDamage = 0;
    this.knockCount = 0;
    this.combo = 0;
    this.comboRate = 0;
  }

  get reach(): number {
    return FIGHTER.baseReach * this.profile.bodyScale;
  }

  get staminaFactor(): number {
    return 0.8 + 0.2 * (this.stamina / VITALS.maxStamina);
  }

  get canAct(): boolean {
    return (
      this.state !== "knockdown" &&
      this.state !== "getup" &&
      this.state !== "hurt" &&
      this.state !== "victory" &&
      this.state !== "defeat" &&
      !this.downed
    );
  }

  get invulnerable(): boolean {
    return this.slipInvuln > 0;
  }

  get blocking(): boolean {
    return this.state === "blocking";
  }

  headWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.model.head.getWorldPosition(out);
  }

  chestWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.model.chest.getWorldPosition(out);
  }

  gloveWorld(side: "L" | "R", out = new THREE.Vector3()): THREE.Vector3 {
    return this.model.gloves[side].getWorldPosition(out);
  }

  /* ================================================================ */

  canThrow(): boolean {
    if (!this.canAct) return false;
    if (this.animator.busy) {
      const p = this.activePunch;
      if (!p) return false;
      if (!p.resolved && this.animator.clipProgress < 0.5) return false;
    }
    return true;
  }

  tryPunch(kind: PunchKind, target: StrikeTarget): boolean {
    if (!this.canThrow()) return false;
    const prof = PUNCHES[kind];
    const cost = prof.stamina * (0.7 + 0.3 * (1 - this.stamina / VITALS.maxStamina));
    if (this.stamina < cost * 0.3) return false;

    this.stamina = Math.max(0, this.stamina - cost);
    this.regenDelay = FIGHTER.staminaRecoverDelay;
    this.thrown++;
    this.activePunch = { kind, target, profile: prof, resolved: false };
    this.setState("punching");
    this.animator.play(this.clips[`punch_${kind}`], { fade: 0.06, speed: 1 });
    return true;
  }

  /** Called by the match when an impact event fizzles out without contact. */
  markMiss(): void {
    if (this.activePunch) this.activePunch.resolved = true;
  }

  registerLand(damage: number, target: StrikeTarget): void {
    this.landed++;
    if (target === "head") this.headLanded++;
    else this.bodyLanded++;
    this.totalDamage += damage;
    this.roundDamage += damage;
    if (this.comboTimer > 0) this.combo++;
    else this.combo = 1;
    this.comboTimer = 1.4;
    this.comboRate = Math.max(this.comboRate, this.combo);
  }

  /** Applies an incoming punch. Returns true if it put the fighter down. */
  takeHit(amount: number, ctx: HitContext): boolean {
    const chin = this.profile.attrs.chin;
    let dmg = amount;

    if (ctx.blocked && !ctx.parried) {
      dmg *= 0.13;
      this.stamina = Math.max(0, this.stamina - 5.5 - amount * 0.35);
      this.regenDelay = FIGHTER.staminaRecoverDelay;
      this.animator.kick(0.12);
      this.audio.punch(amount * 0.5, true);
      return false;
    }
    if (ctx.parried) {
      // Perfect block: attacker is briefly frozen, defender takes nothing.
      this.audio.punch(0.4, true);
      return false;
    }

    dmg /= chin;
    this.health = Math.max(0, this.health - dmg);
    this.stun = Math.min(140, this.stun + ctx.stun / chin);
    this.regenDelay = FIGHTER.staminaRecoverDelay;
    if (ctx.target === "body") {
      this.stamina = Math.max(0, this.stamina - 9 - amount * 0.5);
    }

    this.animator.kick(Math.min(1.2, dmg / 11 + ctx.stun / 40));
    // Hitstun does not stack indefinitely — once staggered, a brief window
    // lets the fighter recover instead of being locked down by a flurry.
    if (this.hurtTimer < 0.12) this.hurtTimer = dmg > 7 ? 0.34 : 0.16;
    this.audio.punch(0.7 + dmg / 18, false);

    if (this.stun >= VITALS.rockedThreshold) this.setState("rocked");

    return this.health <= 0;
  }

  /* ================================================================ */

  private setState(next: FighterState): void {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this.events.stateChanged?.(this, prev, next);
  }

  knockDown(fromDir: number): void {
    this.downed = true;
    this.knockCount++;
    this.knockTotal++;
    this.stamina = Math.max(0, this.stamina - 25);
    this.stun = 0;
    this.activePunch = null;
    this.setState("knockdown");
    const clip = this.stance === "southpaw" ? mirrorClip(buildKnockdownClip(fromDir)) : buildKnockdownClip(fromDir);
    this.animator.play(clip, { hold: true, fade: 0.05 });
    this.events.knockdown?.(this);
  }

  startGetup(): void {
    const clip = this.stance === "southpaw" ? mirrorClip(buildGetupClip()) : buildGetupClip();
    this.setState("getup");
    this.animator.play(clip, { fade: 0.12 });
    this.events.getupStarted?.(this);
  }

  finishGetup(): void {
    this.downed = false;
    this.health = Math.max(VITALS.dangerHealth + 8, this.health);
    this.stamina = Math.max(38, this.stamina);
    this.stun = 0;
    this.setState("idle");
  }

  stayDown(): void {
    this.knockedOut = true;
    this.setState("defeat");
  }

  win(): void {
    this.setState("victory");
    this.animator.play(this.clips.victory, { fade: 0.25, hold: false });
  }

  lose(): void {
    this.setState("defeat");
    this.animator.setBase(this.P.defeat, 0.5);
  }

  /* ================================================================ */

  update(dt: number, opponent: Fighter, allowControl: boolean): void {
    // ---- timers -------------------------------------------------
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.slipCooldown = Math.max(0, this.slipCooldown - dt);
    this.leanCooldown = Math.max(0, this.leanCooldown - dt);
    this.slipInvuln = Math.max(0, this.slipInvuln - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer <= 0) this.combo = 0;

    if (this.downed || !allowControl) {
      this.intent.moveX = 0;
      this.intent.moveZ = 0;
    }

    // ---- facing -------------------------------------------------
    const dx = opponent.pos.x - this.pos.x;
    const dz = opponent.pos.z - this.pos.z;
    const dist = Math.max(0.001, Math.hypot(dx, dz));
    const fwdX = dx / dist;
    const fwdZ = dz / dist;
    const targetYaw = Math.atan2(fwdX, fwdZ);
    let diff = targetYaw - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const yawLerp = Math.min(1, dt * FIGHTER.turnSpeed * (this.canAct ? 1 : 0.3));
    this.yaw += diff * yawLerp;

    // ---- movement -----------------------------------------------
    const leftX = fwdZ;
    const leftZ = -fwdX;
    let mx = this.intent.moveX;
    let mz = this.intent.moveZ;
    const mag = Math.hypot(mx, mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
    }

    const speedScale = this.profile.attrs.footwork * FIGHTER.moveSpeed * this.staminaFactor;
    let vx = (fwdX * mz + leftX * mx) * speedScale;
    let vz = (fwdZ * mz + leftZ * mx) * speedScale;

    if (this.blocking) {
      vx *= 0.45;
      vz *= 0.45;
    }
    if (this.state === "rocked") {
      vx *= 0.6;
      vz *= 0.6;
    }

    // Punch lunge.
    vx += this.lungeX;
    vz += this.lungeZ;
    this.lungeX *= Math.exp(-dt * 9);
    this.lungeZ *= Math.exp(-dt * 9);

    const fromX = this.pos.x;
    const fromZ = this.pos.z;
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;

    // Keep fighters from occupying the same space.
    const sep = dist;
    const minSep = this.bodyRadius + opponent.bodyRadius + 0.16;
    if (sep < minSep) {
      const push = (minSep - sep) * 0.5;
      this.pos.x -= fwdX * push;
      this.pos.z -= fwdZ * push;
    }

    // Ring bounds.
    const b = this.bound;
    this.pos.x = Math.max(-b, Math.min(b, this.pos.x));
    this.pos.z = Math.max(-b, Math.min(b, this.pos.z));
    this.pos.y = 0;

    this.container.position.set(this.pos.x, this.groundY, this.pos.z);
    this.container.rotation.y = this.yaw;

    // ---- footwork ------------------------------------------------
    // Hand the animator the ground the body actually covered, in the fighter's
    // own frame, so the feet take steps instead of skating.
    if (this.downed || this.state === "getup") {
      this.animator.locomotion(0, 0, dt);
    } else {
      const dwx = this.pos.x - fromX;
      const dwz = this.pos.z - fromZ;
      this.animator.locomotion(dwx * leftX + dwz * leftZ, dwx * fwdX + dwz * fwdZ, dt);
    }

    // ---- decisions ----------------------------------------------
    if (allowControl && this.canAct) {
      if (this.intent.slip !== 0 && this.slipCooldown <= 0 && this.stamina > 12) {
        const clip = this.intent.slip < 0 ? this.clips.slipL : this.clips.slipR;
        this.animator.play(clip, { fade: 0.05 });
        this.slipCooldown = 0.62;
        this.slipInvuln = 0.26;
        this.stamina = Math.max(0, this.stamina - 6);
        this.setState("slip");
      } else if (this.intent.lean && this.leanCooldown <= 0 && this.stamina > 12) {
        this.animator.play(this.clips.lean, { fade: 0.05 });
        this.leanCooldown = 0.7;
        this.slipInvuln = 0.22;
        this.stamina = Math.max(0, this.stamina - 5);
        this.setState("slip");
      } else if (this.intent.block) {
        this.setState("blocking");
      } else if (this.state === "blocking" || this.state === "slip") {
        this.setState("idle");
      }
    }

    // Recover from transient states.
    if (this.state === "punching" && !this.animator.busy) {
      this.activePunch = null;
      this.setState(this.intent.block ? "blocking" : "idle");
    }
    if (this.state === "slip" && !this.animator.busy) {
      this.setState(this.intent.block ? "blocking" : "idle");
    }
    if (this.state === "getup" && !this.animator.busy) {
      this.finishGetup();
    }
    if (this.state === "rocked" && this.stun < VITALS.rockedThreshold) {
      this.setState("idle");
    }
    if (this.hurtTimer > 0 && this.state === "idle") {
      this.setState("hurt");
    } else if (this.state === "hurt" && this.hurtTimer <= 0) {
      this.setState(this.intent.block ? "blocking" : "idle");
    }

    // ---- stamina / stun -----------------------------------------
    if (this.state === "blocking") this.blockElapsed += dt;
    else this.blockElapsed = 0;

    const moving = mag > 0.05;
    if (this.regenDelay > 0) this.regenDelay -= dt;
    else {
      const regen =
        (this.blocking ? FIGHTER.blockStaminaRegen : FIGHTER.idleStaminaRegen) *
        this.profile.attrs.stamina +
        this.stamina * 0.06;
      this.stamina = Math.min(VITALS.maxStamina, this.stamina + regen * dt);
    }
    // Punching and slipping burn a trickle.
    if (this.animator.busy) this.stamina = Math.max(0, this.stamina - dt * 2.5);
    if (moving) this.stamina = Math.max(0, this.stamina - dt * 1.4);

    this.stun = Math.max(0, this.stun - VITALS.stunDecay * dt);

    // ---- animation ----------------------------------------------
    this.updateAnimation(dt);

    const pose = this.animator.evaluate(dt);
    Animator.apply(this.model.rig, pose);
  }

  private updateAnimation(dt: number): void {
    if (!this.animator.busy) {
      let base = this.P.guard;
      if (this.state === "victory") base = this.P.victory;
      else if (this.state === "defeat") base = this.P.defeat;
      else if (this.state === "rocked") base = this.P.rocked;
      else if (this.hurtTimer > 0 || this.state === "hurt") base = this.P.hurt;
      else if (this.state === "blocking") base = this.P.block;
      if (base !== this.lastBase) {
        this.animator.setBase(base, base === this.P.hurt ? 0.06 : 0.16);
        this.lastBase = base;
      }
    }

    const a = this.animator;
    const staminaPct = this.stamina / VITALS.maxStamina;
    a.breathAmp = 0.45 + (1 - staminaPct) * 1.5;
    const moving = Math.hypot(this.intent.moveX, this.intent.moveZ) > 0.05 && this.canAct;
    a.bounceAmp += ((moving ? 1 : 0) - a.bounceAmp) * Math.min(1, dt * 7);
    const swayTarget = this.canAct && !moving ? 1 : 0.25;
    a.swayAmp += (swayTarget - a.swayAmp) * Math.min(1, dt * 3);
    const wobbleTarget = this.state === "rocked" ? 1 : this.hurtTimer > 0 ? 0.35 : 0;
    a.wobbleAmp += (wobbleTarget - a.wobbleAmp) * Math.min(1, dt * 8);
    const guardTarget = this.state === "blocking" ? 1 : 0;
    a.guardTightness += (guardTarget - a.guardTightness) * Math.min(1, dt * 10);
  }

  dispose(): void {
    this.model.dispose();
  }
}
