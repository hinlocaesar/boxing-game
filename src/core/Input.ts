import type { PunchKind } from "./types";

export interface InputFrame {
  /** -1..1 strafe (positive = fighter's left), -1..1 forward. */
  moveX: number;
  moveZ: number;
  block: boolean;
  bodyMod: boolean;
  /** Slip direction: -1 left, 0 none, 1 right. */
  slip: number;
  lean: boolean;
  punches: PunchKind[];
  /** Number of Space taps this frame (used for the get-up mini-game). */
  mash: number;
  pause: boolean;
  confirm: boolean;
}

const PUNCH_KEYS: Record<string, PunchKind> = {
  KeyJ: "jab",
  KeyK: "straight",
  KeyL: "hook",
  KeyI: "uppercut",
};

export class Input {
  private keys = new Set<string>();
  private punchQueue: PunchKind[] = [];
  private pauseLatch = false;
  private confirmLatch = false;
  private confirmPrev = false;
  private pausePrev = false;
  private mashCount = 0;
  enabled = true;

  constructor(private target: Window = window) {
    target.addEventListener("keydown", this.onKeyDown, { passive: false });
    target.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("blur", this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === "Space" && this.enabled) this.mashCount++;
    const p = PUNCH_KEYS[e.code];
    if (p && this.enabled) this.punchQueue.push(p);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /* ---------------- gamepad ---------------- */

  private readGamepad(): {
    moveX: number;
    moveZ: number;
    block: boolean;
    body: boolean;
    slip: number;
    punches: PunchKind[];
  } | null {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads.find((p): p is Gamepad => !!p && p.connected);
    if (!pad) return null;

    const dz = (v: number) => (Math.abs(v) < 0.22 ? 0 : v);
    const a0 = pad.axes.length > 0 ? pad.axes[0] : 0;
    const a1 = pad.axes.length > 1 ? pad.axes[1] : 0;
    const moveX = dz(-a0);
    const moveZ = dz(-a1);

    const btn = (i: number) => !!pad.buttons[i]?.pressed;
    const punches: PunchKind[] = [];
    // Edge detection is handled by the caller via a frame-latched set.
    const map: Array<[number, PunchKind]> = [
      [0, "jab"],
      [1, "straight"],
      [2, "hook"],
      [3, "uppercut"],
    ];
    for (const [i, kind] of map) {
      if (btn(i) && !this.padHeld.has(i)) punches.push(kind);
    }
    this.padHeld.clear();
    for (const [i] of map) if (btn(i)) this.padHeld.add(i);

    let slip = 0;
    if (btn(6)) slip = -1;
    else if (btn(7)) slip = 1;

    return {
      moveX,
      moveZ,
      block: btn(4),
      body: btn(5),
      slip,
      punches,
    };
  }

  private padHeld = new Set<number>();

  /* ---------------- public ---------------- */

  /** Reads and clears per-frame state. */
  poll(): InputFrame {
    const gp = this.readGamepad();

    const punches = this.punchQueue;
    this.punchQueue = [];
    if (gp) punches.push(...gp.punches);

    const pauseNow = this.down("Escape", "KeyP");
    const pause = pauseNow && !this.pausePrev;
    this.pausePrev = pauseNow;

    const confirmNow = this.down("Enter", "NumpadEnter");
    const confirm = confirmNow && !this.confirmPrev;
    this.confirmPrev = confirmNow;

    void this.pauseLatch;
    void this.confirmLatch;

    const left = this.down("KeyA") || (gp ? gp.moveX < -0.1 : false);
    const right = this.down("KeyD") || (gp ? gp.moveX > 0.1 : false);
    const fwd = this.down("KeyW") || (gp ? gp.moveZ > 0.1 : false);
    const back = this.down("KeyS") || (gp ? gp.moveZ < -0.1 : false);

    let moveX = (left ? 1 : 0) - (right ? 1 : 0);
    let moveZ = (fwd ? 1 : 0) - (back ? 1 : 0);
    if (gp) {
      if (Math.abs(gp.moveX) > 0.1) moveX = -gp.moveX;
      if (Math.abs(gp.moveZ) > 0.1) moveZ = gp.moveZ;
    }

    let slip = 0;
    if (this.down("KeyQ")) slip = -1;
    else if (this.down("KeyE")) slip = 1;
    if (gp && gp.slip !== 0) slip = gp.slip;

    const mash = this.mashCount;
    this.mashCount = 0;

    return {
      moveX: this.enabled ? moveX : 0,
      moveZ: this.enabled ? moveZ : 0,
      block: this.enabled && (this.down("Space") || (gp?.block ?? false)),
      bodyMod: this.enabled && (this.down("ControlLeft", "ControlRight") || (gp?.body ?? false)),
      slip: this.enabled ? slip : 0,
      lean: this.enabled && this.down("ShiftLeft", "ShiftRight"),
      punches: this.enabled ? punches : [],
      mash,
      pause,
      confirm,
    };
  }

  dispose(): void {
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("blur", this.onBlur);
  }
}
