import * as THREE from "three";

interface Particle {
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
}

function softDotTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.72)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ParticlePool {
  readonly points: THREE.Points;

  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private col: Float32Array;
  private base: Float32Array;
  private size: Float32Array;
  private baseSize: Float32Array;
  private meta: Particle[];
  private cursor = 0;
  private anyAlive = false;

  constructor(
    private capacity: number,
    blending: THREE.Blending,
    pointSize: number,
    texture: THREE.Texture,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.base = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.meta = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.meta[i] = { vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, gravity: -6, drag: 2 };
      this.pos[i * 3 + 1] = -999;
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1));

    const mat = new THREE.PointsMaterial({
      size: pointSize,
      map: texture,
      transparent: true,
      depthWrite: false,
      blending,
      vertexColors: true,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  spawn(
    origin: THREE.Vector3,
    count: number,
    opts: {
      speed: number;
      spread: number;
      color: THREE.Color;
      life: number;
      size: number;
      gravity?: number;
      dir?: THREE.Vector3;
      jitter?: number;
    },
  ): void {
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const m = this.meta[idx];

      let vx = (Math.random() - 0.5) * 2 * opts.spread;
      let vy = (Math.random() - 0.5) * 2 * opts.spread + opts.speed * 0.25;
      let vz = (Math.random() - 0.5) * 2 * opts.spread;
      if (opts.dir) {
        vx += opts.dir.x * opts.speed;
        vy += opts.dir.y * opts.speed;
        vz += opts.dir.z * opts.speed;
      }
      m.vx = vx;
      m.vy = vy;
      m.vz = vz;
      m.maxLife = opts.life * (0.65 + Math.random() * 0.7);
      m.life = m.maxLife;
      m.gravity = opts.gravity ?? -6;
      m.drag = 1.6 + Math.random();

      const j = opts.jitter ?? 0.03;
      this.pos[idx * 3] = origin.x + (Math.random() - 0.5) * j;
      this.pos[idx * 3 + 1] = origin.y + (Math.random() - 0.5) * j;
      this.pos[idx * 3 + 2] = origin.z + (Math.random() - 0.5) * j;

      const shade = 0.75 + Math.random() * 0.5;
      this.base[idx * 3] = opts.color.r * shade;
      this.base[idx * 3 + 1] = opts.color.g * shade;
      this.base[idx * 3 + 2] = opts.color.b * shade;
      this.baseSize[idx] = opts.size * (0.7 + Math.random() * 0.8);
      this.size[idx] = this.baseSize[idx];
      this.col[idx * 3] = this.base[idx * 3];
      this.col[idx * 3 + 1] = this.base[idx * 3 + 1];
      this.col[idx * 3 + 2] = this.base[idx * 3 + 2];
    }
    this.anyAlive = true;
    this.markDirty();
  }

  update(dt: number): void {
    if (!this.anyAlive) return;
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      const m = this.meta[i];
      if (m.life <= 0) continue;

      m.life -= dt;
      if (m.life <= 0) {
        this.pos[i * 3 + 1] = -999;
        this.size[i] = 0;
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      alive++;

      const damp = Math.exp(-m.drag * dt);
      m.vx *= damp;
      m.vz *= damp;
      m.vy = m.vy * damp + m.gravity * dt;
      this.pos[i * 3] += m.vx * dt;
      this.pos[i * 3 + 1] += m.vy * dt;
      this.pos[i * 3 + 2] += m.vz * dt;
      if (this.pos[i * 3 + 1] < -0.5) m.life = 0;

      const t = Math.max(0, m.life / m.maxLife);
      const fade = t * t;
      this.col[i * 3] = this.base[i * 3] * fade;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * fade;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * fade;
      this.size[i] = this.baseSize[i] * (0.35 + 0.65 * t);
    }
    this.anyAlive = alive > 0;
    this.markDirty();
  }

  private markDirty(): void {
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) {
      this.meta[i].life = 0;
      this.pos[i * 3 + 1] = -999;
      this.size[i] = 0;
    }
    this.anyAlive = false;
    this.markDirty();
  }
}

export class Effects {
  readonly group = new THREE.Group();
  private sparks: ParticlePool;
  private flashes: ParticlePool;
  private texture: THREE.Texture;
  private flashTimer = 0;
  private tmp = new THREE.Vector3();

  private static SWEAT = new THREE.Color(0xdfe9ff);
  private static SPARK = new THREE.Color(0xffd98a);
  private static DUST = new THREE.Color(0x9fb0c8);
  private static FLASH = new THREE.Color(0xffffff);

  constructor() {
    this.texture = softDotTexture();
    this.sparks = new ParticlePool(700, THREE.AdditiveBlending, 0.07, this.texture);
    this.flashes = new ParticlePool(160, THREE.AdditiveBlending, 0.22, this.texture);
    this.group.add(this.sparks.points);
    this.group.add(this.flashes.points);
  }

  impact(point: THREE.Vector3, dir: THREE.Vector3, power: number): void {
    this.sparks.spawn(point, Math.round(10 + power * 16), {
      speed: 3.4 + power * 3,
      spread: 1.5,
      color: Effects.SWEAT,
      life: 0.42,
      size: 0.045,
      gravity: -9,
      dir,
      jitter: 0.06,
    });
    this.sparks.spawn(point, Math.round(4 + power * 8), {
      speed: 2.2 + power * 3.4,
      spread: 1.1,
      color: Effects.SPARK,
      life: 0.2,
      size: 0.06,
      gravity: -3,
      dir,
      jitter: 0.04,
    });
  }

  blockHit(point: THREE.Vector3, dir: THREE.Vector3): void {
    this.sparks.spawn(point, 8, {
      speed: 2.1,
      spread: 1.2,
      color: Effects.DUST,
      life: 0.24,
      size: 0.035,
      gravity: -5,
      dir,
      jitter: 0.05,
    });
  }

  whiff(point: THREE.Vector3, dir: THREE.Vector3): void {
    this.sparks.spawn(point, 6, {
      speed: 1.6,
      spread: 1.5,
      color: Effects.DUST,
      life: 0.3,
      size: 0.03,
      gravity: -1.5,
      dir,
      jitter: 0.1,
    });
  }

  dust(point: THREE.Vector3, amount = 1): void {
    this.sparks.spawn(point, Math.round(14 * amount), {
      speed: 1.9 * amount,
      spread: 2.1,
      color: Effects.DUST,
      life: 0.85,
      size: 0.09,
      gravity: -1.2,
      jitter: 0.3,
    });
  }

  crowdFlash(count = 4): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 9.5 + Math.random() * 7;
      this.tmp.set(Math.cos(a) * r, 0.6 + Math.random() * 5.5, Math.sin(a) * r);
      this.flashes.spawn(this.tmp, 1, {
        speed: 0,
        spread: 0,
        color: Effects.FLASH,
        life: 0.16,
        size: 0.28 + Math.random() * 0.22,
        gravity: 0,
        jitter: 0.02,
      });
    }
  }

  clear(): void {
    this.sparks.clear();
    this.flashes.clear();
  }

  update(dt: number, excitement: number): void {
    this.sparks.update(dt);
    this.flashes.update(dt);

    this.flashTimer -= dt;
    if (this.flashTimer <= 0) {
      this.flashTimer = 0.08 + Math.random() * 0.5 * (1.2 - excitement);
      this.crowdFlash(excitement > 0.6 ? 3 : 1);
    }
  }
}
