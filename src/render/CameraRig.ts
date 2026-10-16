import * as THREE from "three";
import { CAMERA } from "../core/constants";
import type { Fighter } from "../entities/Fighter";

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  private pos = new THREE.Vector3(0, 2.2, 6);
  private look = new THREE.Vector3(0, 1.3, 0);
  private desiredPos = new THREE.Vector3();
  private desiredLook = new THREE.Vector3();
  private shake = 0;
  private shakeRot = 0;
  private fovPunch = 0;
  private koMode = false;
  private koAngle = 0;
  private koFocus = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private dist = CAMERA.distance;
  private groundY = 0;
  private bounds = 2.63;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.1, 220);
    this.camera.position.copy(this.pos);
  }

  setGround(y: number): void {
    this.groundY = y;
  }

  setBounds(half: number): void {
    this.bounds = half;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  punchFov(amount: number): void {
    this.fovPunch = Math.min(6, this.fovPunch + amount);
  }

  reset(): void {
    this.shake = 0;
    this.fovPunch = 0;
    this.koMode = false;
  }

  startKoOrbit(focus: THREE.Vector3): void {
    this.koMode = true;
    this.koAngle = Math.atan2(this.camera.position.x - focus.x, this.camera.position.z - focus.z);
    this.koFocus.copy(focus);
  }

  stopKoOrbit(): void {
    this.koMode = false;
  }

  /** Close-up camera for knockdowns / celebrations. */
  focusOn(focus: THREE.Vector3, angle: number): void {
    this.koMode = true;
    this.koAngle = angle;
    this.koFocus.copy(focus);
  }

  update(dt: number, player: Fighter, opponent: Fighter): void {
    if (this.koMode) {
      this.koAngle += dt * CAMERA.koOrbitSpeed;
      const r = 4.3;
      const kx = this.koFocus.x + Math.sin(this.koAngle) * r;
      const kz = this.koFocus.z + Math.cos(this.koAngle) * r;
      const kr = Math.hypot(kx, kz);
      const maxR = this.bounds + 1.7;
      const s = kr > maxR ? maxR / kr : 1;
      this.desiredPos.set(kx * s, this.koFocus.y + 2.0, kz * s);
      this.desiredLook.copy(this.koFocus).add(this.tmp.set(0, 0.35, 0));
    } else {
      this.tmp.subVectors(opponent.pos, player.pos);
      this.tmp.y = 0;
      const sep = Math.max(0.4, this.tmp.length());
      this.tmp.normalize();

      // Pivot on the pair's midpoint so the frame stays settled.
      const mx = (player.pos.x + opponent.pos.x) * 0.5;
      const mz = (player.pos.z + opponent.pos.z) * 0.5;

      // Camera direction: straight behind the player.
      let dx = -this.tmp.x;
      let dz = -this.tmp.z;

      // As the action drifts toward the ropes, swing the camera round toward
      // the ring centre so we stay inside the ropes instead of shooting through them.
      const mr = Math.hypot(mx, mz);
      const edge = Math.max(0, Math.min(1, (mr - (this.bounds - 0.75)) / 0.95));
      if (edge > 0.001 && mr > 0.001) {
        const cx = -mx / mr;
        const cz = -mz / mr;
        const k = edge * 0.85;
        dx += (cx - dx) * k;
        dz += (cz - dz) * k;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
      }

      const d = this.dist + Math.max(0, 1.9 - sep) * 0.5;
      // Shift the camera off the fighter axis so both boxers stay visible.
      const leftX = -dz;
      const leftZ = dx;
      let px = mx + dx * d + leftX * CAMERA.lateral;
      let pz = mz + dz * d + leftZ * CAMERA.lateral;

      const maxR = this.bounds + 0.9;
      const pr = Math.hypot(px, pz);
      if (pr > maxR) {
        const s = maxR / pr;
        px *= s;
        pz *= s;
      }

      this.desiredPos.set(px, this.groundY + CAMERA.height, pz);

      const mid = this.tmp2.set(
        player.pos.x + (opponent.pos.x - player.pos.x) * CAMERA.opponentBias,
        this.groundY + CAMERA.lookHeight,
        player.pos.z + (opponent.pos.z - player.pos.z) * CAMERA.opponentBias,
      );
      this.desiredLook.copy(mid);
    }

    const posLerp = this.koMode ? 1 - Math.exp(-dt * 2.2) : 1 - Math.exp(-dt * 6.5);
    this.pos.lerp(this.desiredPos, Math.min(1, posLerp));
    this.look.lerp(this.desiredLook, Math.min(1, 1 - Math.exp(-dt * 7.5)));

    // Shake.
    this.shake = Math.max(0, this.shake - dt * CAMERA.shakeDecay * (0.4 + this.shake));
    this.shakeRot = Math.max(0, this.shakeRot - dt * CAMERA.shakeDecay);
    const s = this.shake * this.shake;
    this.camera.position.set(
      this.pos.x + (Math.random() - 0.5) * s * 0.55,
      this.pos.y + (Math.random() - 0.5) * s * 0.45,
      this.pos.z + (Math.random() - 0.5) * s * 0.55,
    );
    this.camera.lookAt(this.look);
    if (this.shakeRot > 0.001) {
      this.camera.rotateZ((Math.random() - 0.5) * this.shakeRot * 0.06);
    }

    this.fovPunch *= Math.exp(-dt * 5);
    const fov = CAMERA.fov + this.fovPunch;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
