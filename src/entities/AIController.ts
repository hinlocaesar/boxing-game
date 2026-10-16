import { DIFFICULTY_TUNING, PUNCHES } from "../core/constants";
import type { Difficulty, FighterProfile, PunchKind, StrikeTarget } from "../core/types";
import type { Fighter } from "./Fighter";

interface AISettings {
  reaction: number;
  aggression: number;
  error: number;
  guard: number;
}

const RANGE_BY_STYLE: Record<string, number> = {
  Boxer: 1.95,
  "Counter-Puncher": 1.9,
  Technician: 1.85,
  "All-Rounder": 1.6,
  Brawler: 1.25,
  Slugger: 1.15,
};

export class AIController {
  private settings: AISettings;
  private profile: FighterProfile;
  private decisionTimer = 0;
  private comboLeft = 0;
  private comboTimer = 0;
  private circleTimer = 0;
  private circleDir = 1;
  private blockHold = 0;
  private reactionTimer = 0;
  private slipDir = 0;
  private slipHold = 0;
  private restTimer = 0;
  private time = 0;

  constructor(profile: FighterProfile, difficulty: Difficulty, rating: number) {
    this.profile = profile;
    const base = DIFFICULTY_TUNING[difficulty];
    this.settings = {
      reaction: base.reaction / rating,
      aggression: Math.min(1.12, base.aggression * rating),
      error: base.error / rating,
      guard: Math.min(0.98, base.guard * (0.6 + rating * 0.4)),
    };
  }

  private pickAttack(dist: number): { kind: PunchKind; target: StrikeTarget } {
    const style = this.profile.style;
    const closeRange = dist < 1.35;
    const roll = Math.random();

    let kind: PunchKind;
    switch (style) {
      case "Brawler":
      case "Slugger":
        kind = roll < 0.34 ? "hook" : roll < 0.62 ? "uppercut" : roll < 0.8 ? "straight" : "jab";
        break;
      case "Boxer":
      case "Technician":
        kind = roll < 0.42 ? "jab" : roll < 0.78 ? "straight" : roll < 0.92 ? "hook" : "uppercut";
        break;
      case "Counter-Puncher":
        kind = roll < 0.3 ? "straight" : roll < 0.6 ? "uppercut" : roll < 0.78 ? "jab" : "hook";
        break;
      default:
        kind = roll < 0.32 ? "jab" : roll < 0.62 ? "straight" : roll < 0.85 ? "hook" : "uppercut";
    }

    // Uppercuts and hooks need room to wind up.
    if (!closeRange && (kind === "uppercut" || kind === "hook")) {
      if (Math.random() < 0.5) kind = "straight";
    }

    const bodyBias =
      style === "Brawler" || style === "Slugger" ? 0.42 : style === "Counter-Puncher" ? 0.35 : 0.26;
    const target: StrikeTarget = Math.random() < bodyBias ? "body" : "head";
    return { kind, target };
  }

  update(dt: number, self: Fighter, opponent: Fighter): void {
    this.time += dt;
    const intent = self.intent;

    // Reset transient intents.
    intent.block = false;
    intent.slip = 0;
    intent.lean = false;

    if (!self.canAct || self.downed) {
      intent.moveX = 0;
      intent.moveZ = 0;
      return;
    }

    const dx = opponent.pos.x - self.pos.x;
    const dz = opponent.pos.z - self.pos.z;
    const dist = Math.max(0.001, Math.hypot(dx, dz));

    const ai = this.profile.ai;
    const aggression = Math.max(0.25, Math.min(1.15, this.settings.aggression * (0.55 + ai.aggression * 0.7)));
    const guardSkill = Math.min(0.95, this.settings.guard * (0.5 + ai.defense * 0.5));

    /* ---------------- defence ---------------- */
    this.reactionTimer -= dt;
    this.blockHold = Math.max(0, this.blockHold - dt);
    this.slipHold = Math.max(0, this.slipHold - dt);

    const threat =
      opponent.activePunch !== null &&
      !opponent.activePunch.resolved &&
      opponent.canAct &&
      dist < self.reach + 0.7;

    if (threat && this.reactionTimer <= 0) {
      this.reactionTimer = this.settings.reaction * (0.7 + Math.random() * 0.8);
      const r = Math.random();
      if (r < guardSkill) {
        this.blockHold = 0.22 + Math.random() * 0.26;
      } else if (r < guardSkill + 0.18 * ai.defense) {
        this.slipDir = Math.random() < 0.5 ? -1 : 1;
        this.slipHold = 0.22;
      }
      // Otherwise the shot gets through — the AI simply eats it.
    }

    if (this.blockHold > 0) intent.block = true;
    if (this.slipHold > 0) intent.slip = this.slipDir;

    /* ---------------- stamina rest ---------------- */
    if (self.stamina < 22 && this.restTimer <= 0) this.restTimer = 1.6 + Math.random() * 1.4;
    this.restTimer = Math.max(0, this.restTimer - dt);

    /* ---------------- movement ---------------- */
    const desired = (RANGE_BY_STYLE[this.profile.style] ?? 1.6) * (0.92 + this.settings.error * 0.3);

    this.circleTimer -= dt;
    if (this.circleTimer <= 0) {
      this.circleTimer = 1.1 + Math.random() * 2.2;
      this.circleDir = Math.random() < 0.5 ? -1 : 1;
    }

    let moveZ = Math.max(-1, Math.min(1, (dist - desired) * 1.5));
    let moveX = this.circleDir * 0.8;

    if (this.restTimer > 0 && dist < 2.1) {
      moveZ = -0.9;
      moveX = this.circleDir;
    }
    if (intent.block) {
      moveZ *= 0.45;
      moveX *= 0.4;
    }

    // Stay off the ropes when possible.
    const nearEdge = Math.max(Math.abs(self.pos.x), Math.abs(self.pos.z)) > self.bound - 0.35;
    if (nearEdge) {
      moveX += self.pos.x * 0.4;
    }

    intent.moveX = moveX;
    intent.moveZ = moveZ;

    /* ---------------- offence ---------------- */
    this.comboTimer -= dt;
    this.decisionTimer -= dt;

    if (this.comboLeft > 0 && this.comboTimer <= 0) {
      this.comboTimer = 0.16 + Math.random() * 0.22;
      this.comboLeft--;
      const { kind, target } = this.pickAttack(dist);
      if (self.tryPunch(kind, target)) {
        this.decisionTimer = 0.25 + Math.random() * 0.2;
      }
    }

    if (this.decisionTimer <= 0) {
      const inRange = dist < self.reach + PUNCHES.straight.reach + 0.12;
      const canPress = self.stamina > 30 && this.restTimer <= 0;
      const willing = Math.random() < aggression;

      if (inRange && canPress && willing) {
        const comboLen =
          Math.random() < ai.comboBias * 0.7 ? 2 + Math.floor(Math.random() * 3) : 1;
        this.comboLeft = comboLen;
        this.comboTimer = 0;
        this.decisionTimer = 1.15 + Math.random() * 1.5;
      } else if (inRange && canPress && Math.random() < ai.counterBias * 0.5) {
        // Counter-punchers fire right after defending.
        if (this.blockHold > 0 || this.slipHold > 0) {
          const { kind, target } = this.pickAttack(dist);
          self.tryPunch(kind, target);
        }
        this.decisionTimer = 0.7 + Math.random() * 0.8;
      } else {
        this.decisionTimer = 0.3 + Math.random() * 0.55;
      }
    }

    // Occasionally lean away from pressure.
    if (opponent.activePunch && dist < 1.1 && Math.random() < 0.02) {
      intent.lean = true;
    }
  }

  reset(): void {
    this.decisionTimer = 0;
    this.comboLeft = 0;
    this.comboTimer = 0;
    this.blockHold = 0;
    this.slipHold = 0;
    this.restTimer = 0;
    this.reactionTimer = 0;
  }
}
