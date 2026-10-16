import * as THREE from "three";
import { makeRibbonTexture } from "./textures";

export interface Arena {
  group: THREE.Group;
  keyLight: THREE.SpotLight;
  crowdCount: number;
  update(dt: number, focus: THREE.Vector3): void;
  dispose(): void;
}

const CROWD_PALETTE = [
  0x1c2233, 0x2a1f2c, 0x131722, 0x33232a, 0x1f2b33, 0x2c2c34, 0x40232a, 0x1a1f2e, 0x3a2f22, 0x22283a,
];
const CROWD_ACCENTS = [0x8a5a52, 0x4a5f8a, 0xa08a4a, 0xc9c9d2, 0x6a5a8a, 0x4a8a6a];

export function buildArena(): Arena {
  const group = new THREE.Group();
  group.name = "arena";
  const trash: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    trash.push(x);
    return x;
  };

  /* ---------------- floor ---------------- */
  const floorGeo = keep(new THREE.CircleGeometry(30, 64));
  const floorMat = keep(
    new THREE.MeshStandardMaterial({ color: 0x070910, roughness: 0.55, metalness: 0.25 }),
  );
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  floor.receiveShadow = true;
  group.add(floor);

  /* ---------------- crowd ---------------- */
  const tiers = [
    { radius: 9.4, y: 0.35, rows: 4, perRow: 68, tilt: 0.34 },
    { radius: 12.4, y: 2.05, rows: 4, perRow: 84, tilt: 0.4 },
    { radius: 15.6, y: 4.15, rows: 3, perRow: 92, tilt: 0.46 },
  ];

  let total = 0;
  for (const t of tiers) total += t.rows * t.perRow;

  const seatGeo = keep(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 8));
  const seatMat = keep(new THREE.MeshStandardMaterial({ color: 0x11141d, roughness: 0.95 }));
  const bodyGeo = keep(new THREE.CapsuleGeometry(0.17, 0.34, 3, 8));
  const bodyMat = keep(new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.02, vertexColors: false }));

  const crowd = new THREE.InstancedMesh(bodyGeo, bodyMat, total);
  crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  crowd.castShadow = false;
  crowd.receiveShadow = false;
  const color = new THREE.Color();

  const base: THREE.Vector3[] = new Array(total);
  const seatMesh = new THREE.InstancedMesh(seatGeo, seatMat, total);
  const dummy = new THREE.Object3D();

  let idx = 0;
  for (const t of tiers) {
    for (let row = 0; row < t.rows; row++) {
      const radius = t.radius + row * 0.85;
      const y = t.y + row * 0.78;
      for (let i = 0; i < t.perRow; i++) {
        const a = (i / t.perRow) * Math.PI * 2 + row * 0.06 + Math.random() * 0.025;
        const jitter = (Math.random() - 0.5) * 0.7;
        const x = Math.cos(a) * (radius + jitter * 0.25);
        const z = Math.sin(a) * (radius + jitter * 0.25);
        const yy = y + (Math.random() - 0.5) * 0.12;
        base[idx] = new THREE.Vector3(x, yy, z);

        dummy.position.set(x, yy, z);
        dummy.rotation.set(0, -a + Math.PI / 2, 0);
        dummy.scale.set(1, 0.94 + Math.random() * 0.16, 1);
        dummy.updateMatrix();
        crowd.setMatrixAt(idx, dummy.matrix);

        const accent = Math.random() < 0.016;
        color.setHex(accent ? CROWD_ACCENTS[(Math.random() * CROWD_ACCENTS.length) | 0] : CROWD_PALETTE[(Math.random() * CROWD_PALETTE.length) | 0]);
        crowd.setColorAt(idx, color);

        dummy.position.set(x, y - 0.42, z);
        dummy.rotation.set(-t.tilt, -a + Math.PI / 2, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        seatMesh.setMatrixAt(idx, dummy.matrix);
        idx++;
      }
    }
  }
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  group.add(crowd);
  group.add(seatMesh);

  /* ---------------- walls ---------------- */
  const wallGeo = keep(new THREE.CylinderGeometry(20, 20, 14, 48, 1, true));
  const wallMat = keep(
    new THREE.MeshStandardMaterial({ color: 0x090b12, roughness: 1, side: THREE.BackSide }),
  );
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.y = 6;
  group.add(wall);

  const ribbonTex = keep(makeRibbonTexture());
  ribbonTex.repeat.set(-6, 1);
  const ribbonGeo = keep(new THREE.CylinderGeometry(17.4, 17.4, 1.15, 64, 1, true));
  const ribbonMat = keep(
    new THREE.MeshStandardMaterial({
      map: ribbonTex,
      emissive: 0xffffff,
      emissiveMap: ribbonTex,
      emissiveIntensity: 0.42,
      roughness: 0.6,
      side: THREE.BackSide,
    }),
  );
  const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
  ribbon.position.y = 3.35;
  ribbon.rotation.y = Math.PI;
  group.add(ribbon);

  /* ---------------- ceiling truss + fixtures ---------------- */
  const trussMat = keep(new THREE.MeshStandardMaterial({ color: 0x151a26, roughness: 0.8, metalness: 0.4 }));
  const trussGeo = keep(new THREE.BoxGeometry(24, 0.35, 0.35));
  for (let i = 0; i < 6; i++) {
    const beam = new THREE.Mesh(trussGeo, trussMat);
    const a = (i / 6) * Math.PI * 2;
    beam.position.set(Math.cos(a) * 9, 9.5, Math.sin(a) * 9);
    beam.rotation.y = a + Math.PI / 2;
    group.add(beam);
  }
  const fixtureGeo = keep(new THREE.SphereGeometry(0.22, 12, 10));
  const fixtureMat = keep(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff2d0,
      emissiveIntensity: 1.5,
      roughness: 0.3,
    }),
  );
  const fixtures: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const f = new THREE.Mesh(fixtureGeo, fixtureMat);
    f.position.set(Math.cos(a) * 8.2, 9.1, Math.sin(a) * 8.2);
    group.add(f);
    fixtures.push(f);
  }

  /* ---------------- lighting ---------------- */
  const hemi = new THREE.HemisphereLight(0x4a5e82, 0x0a0c14, 0.52);
  group.add(hemi);

  const keyLight = new THREE.SpotLight(0xfff4e2, 1.55, 0, 0.72, 0.55, 0);
  keyLight.position.set(0, 9.6, 0);
  keyLight.target.position.set(0, 0.95, 0);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 2;
  keyLight.shadow.camera.far = 22;
  keyLight.shadow.camera.fov = 62;
  keyLight.shadow.bias = -0.0008;
  keyLight.shadow.normalBias = 0.02;
  group.add(keyLight);
  group.add(keyLight.target);

  const ringSpots: THREE.SpotLight[] = [];
  const spotColors = [0xfff1d6, 0xd7e4ff, 0xffe0c0, 0xcfe0ff];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const s = new THREE.SpotLight(spotColors[i], 0.7, 0, 0.9, 0.85, 0);
    s.position.set(Math.cos(a) * 8.2, 9.1, Math.sin(a) * 8.2);
    s.target.position.set(0, 0.95, 0);
    group.add(s);
    group.add(s.target);
    ringSpots.push(s);
  }

  const rimA = new THREE.SpotLight(0x6f8dff, 0.55, 0, 0.8, 0.9, 0);
  rimA.position.set(-8, 5.5, -9);
  rimA.target.position.set(0, 1.4, 0);
  group.add(rimA);
  group.add(rimA.target);
  const rimB = new THREE.SpotLight(0xff8a5c, 0.45, 0, 0.8, 0.9, 0);
  rimB.position.set(8, 5.5, 9);
  rimB.target.position.set(0, 1.4, 0);
  group.add(rimB);
  group.add(rimB.target);

  const focusSmoothed = new THREE.Vector3();
  let t = 0;

  return {
    group,
    keyLight,
    crowdCount: total,
    update(dt, focus) {
      t += dt;
      focusSmoothed.lerp(focus, Math.min(1, dt * 1.6));
      keyLight.target.position.set(focusSmoothed.x, 0.95, focusSmoothed.z);
      keyLight.position.set(focusSmoothed.x * 0.6, 9.6, focusSmoothed.z * 0.6);

      // Crowd sway.
      const sway = Math.sin(t * 1.6) * 0.02;
      const bounce = Math.abs(Math.sin(t * 2.3)) * 0.03;
      for (let i = 0; i < crowd.count; i += 3) {
        const b = base[i];
        dummy.position.set(
          b.x + Math.sin(t * 2 + i * 0.37) * 0.05,
          b.y + sway + Math.sin(t * 3.1 + i * 0.51) * bounce * 0.5,
          b.z,
        );
        dummy.rotation.set(0, Math.atan2(-b.x, -b.z), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        crowd.setMatrixAt(i, dummy.matrix);
      }
      crowd.instanceMatrix.needsUpdate = true;

      // Fixture flicker.
      for (let i = 0; i < fixtures.length; i++) {
        const f = fixtures[i];
        const flick = 1.35 + Math.sin(t * 17 + i * 2.1) * 0.08 + Math.random() * 0.05;
        (f.material as THREE.MeshStandardMaterial).emissiveIntensity = flick;
      }
    },
    dispose() {
      for (const x of trash) x.dispose();
    },
  };
}
