import type { Fighter } from "../entities/Fighter";

export type Phase = "intro" | "fight" | "down" | "between" | "over";

export interface JudgeCard {
  p1: number;
  p2: number;
}

export interface RoundLog {
  round: number;
  p1: number;
  p2: number;
}

/**
 * Owns round structure, the clock, and the judges' scorecards.
 * The Game orchestrates the presentation around it.
 */
export class Match {
  phase: Phase = "intro";
  round = 1;
  clock = 180;
  introTimer = 3.4;
  betweenTimer = 0;

  readonly judges: JudgeCard[];
  readonly roundLog: RoundLog[] = [];

  winner: 0 | 1 | null = null;
  method = "";
  detail = "";
  finished = false;
  /** True when the result came off the judges' cards. */
  decided = false;

  private tenFired = false;

  constructor(
    private totalRounds: number,
    private roundLength: number,
    judgeCount = 3,
  ) {
    this.judges = Array.from({ length: judgeCount }, () => ({ p1: 0, p2: 0 }));
    this.clock = roundLength;
  }

  get totalRoundsCount(): number {
    return this.totalRounds;
  }

  get clockString(): string {
    const t = Math.max(0, Math.ceil(this.clock));
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  startRound(round: number): void {
    this.round = round;
    this.clock = this.roundLength;
    this.tenFired = false;
    if (round === 1) {
      this.phase = "intro";
      this.introTimer = 3.4;
    } else {
      this.phase = "between";
      this.betweenTimer = 6;
    }
  }

  beginFighting(): void {
    this.phase = "fight";
  }

  /** Returns an event token when something noteworthy happens this frame. */
  tick(dt: number): "ten" | "roundOver" | null {
    if (this.phase !== "fight") return null;
    this.clock -= dt;
    if (!this.tenFired && this.clock <= 10) {
      this.tenFired = true;
      return "ten";
    }
    if (this.clock <= 0) {
      this.clock = 0;
      return "roundOver";
    }
    return null;
  }

  /* ---------------- scoring ---------------- */

  private static roundValue(f: Fighter): number {
    const acc = f.thrown > 0 ? f.landed / f.thrown : 0;
    return f.roundDamage + f.knockCount * 14 + acc * 7 + f.landed * 0.12;
  }

  /**
   * Scores the completed round. Returns the official card for the round.
   */
  scoreRound(p1: Fighter, p2: Fighter): { p1: number; p2: number } {
    const v1 = Match.roundValue(p1);
    const v2 = Match.roundValue(p2);
    const knocks = Math.max(p1.knockCount, p2.knockCount);
    const lopsided = Math.abs(v1 - v2) > Math.max(v1, v2) * 0.6;
    const margin = knocks > 0 || lopsided ? 2 : 1;

    let base1: number;
    let base2: number;
    if (Math.abs(v1 - v2) < 1e-6) {
      base1 = base2 = 10;
    } else if (v1 > v2) {
      base1 = 10;
      base2 = 10 - margin;
    } else {
      base2 = 10;
      base1 = 10 - margin;
    }

    for (const judge of this.judges) {
      // Occasionally a judge sees a close round the other way.
      const flips = base1 !== base2 && Math.random() < 0.12;
      judge.p1 += flips ? base2 : base1;
      judge.p2 += flips ? base1 : base2;
    }
    this.roundLog.push({ round: this.round, p1: base1, p2: base2 });

    return { p1: base1, p2: base2 };
  }

  /** Final decision once all rounds are in the books. */
  decideByPoints(): void {
    let p1Wins = 0;
    let p2Wins = 0;
    let draws = 0;
    for (const j of this.judges) {
      if (j.p1 > j.p2) p1Wins++;
      else if (j.p2 > j.p1) p2Wins++;
      else draws++;
    }

    this.finished = true;
    this.decided = true;
    this.phase = "over";

    this.detail = `Scorecards: ${this.judges.map((j) => `${j.p1}-${j.p2}`).join("  ·  ")}`;

    if (p1Wins === p2Wins) {
      this.winner = null;
      this.method = "Draw";
      return;
    }

    this.winner = p1Wins > p2Wins ? 0 : 1;

    if (p1Wins > 0 && p2Wins > 0) {
      this.method = "Split Decision";
    } else if (draws > 0) {
      this.method = "Majority Decision";
    } else {
      this.method = "Unanimous Decision";
    }
  }

  finish(winner: 0 | 1 | null, method: string, detail: string): void {
    this.winner = winner;
    this.method = method;
    this.detail = detail;
    this.finished = true;
    this.phase = "over";
  }

  scoreText(): string {
    return this.judges.map((j) => `${j.p1}-${j.p2}`).join("   ");
  }
}
