import * as THREE from "three";
import { RING } from "../core/constants";
import { makeApronTexture, makeRingCanvasTexture } from "./textures";

export interface Ring {
  group: THREE.Group;
  /** Resting height of the canvas top, in world units. */
  canvasY: number;
  /** Maximum |x| / |z| a fighter's feet may occupy. */
  bound: number;
  dispose(): void;
}

export function buildRing(): Ring {
  const group = new THREE.Group();
  group.name = "ring";
  const trash: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    trash.push(x);
    return x;
  };

  const half = RING.inner / 2;
  const platformHalf = half + RING.apron;
  const top = RING.canvasHeight;

  /* ---------------- platform ---------------- */
  const canvasTex = keep(makeRingCanvasTexture());
  const apronTex = keep(makeApronTexture());
  apronTex.repeat.set(1, 1);

  const topMat = keep(
    new THREE.MeshStandardMaterial({ map: canvasTex, roughness: 0.86, metalness: 0.02 }),
  );
  const apronMat = keep(
    new THREE.MeshStandardMaterial({ map: apronTex, roughness: 0.9, metalness: 0.03 }),
  );
  const bottomMat = keep(new THREE.MeshStandardMaterial({ color: 0x05070d, roughness: 1 }));

  const platformGeo = keep(new THREE.BoxGeometry(platformHalf * 2, top, platformHalf * 2));
  const platform = new THREE.Mesh(platformGeo, [
    apronMat,
    apronMat,
    topMat,
    bottomMat,
    apronMat,
    apronMat,
  ]);
  platform.position.y = top / 2;
  platform.receiveShadow = true;
  platform.castShadow = true;
  group.add(platform);

  /* ---------------- posts & ropes ---------------- */
  const corners: Array<[number, number]> = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];
  const cornerColors = [0xd21a14, 0xe9e9ef, 0x1f6fe0, 0xe9e9ef];

  const postGeo = keep(new THREE.CylinderGeometry(RING.postRadius, RING.postRadius, 1.7, 14));
  const capGeo = keep(new THREE.SphereGeometry(RING.postRadius * 1.5, 14, 10));
  const padGeo = keep(new THREE.CylinderGeometry(0.115, 0.115, 1.42, 14));
  const buckleGeo = keep(new THREE.BoxGeometry(0.17, 0.19, 0.17));

  corners.forEach(([cx, cz], i) => {
    const postMat = keep(new THREE.MeshStandardMaterial({ color: 0x9aa3b4, roughness: 0.42, metalness: 0.75 }));
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(cx, top + 0.85, cz);
    post.castShadow = true;
    group.add(post);

    const cap = new THREE.Mesh(capGeo, postMat);
    cap.position.set(cx, top + 1.72, cz);
    group.add(cap);

    const colorMat = keep(new THREE.MeshStandardMaterial({ color: cornerColors[i], roughness: 0.55 }));
    const pad = new THREE.Mesh(padGeo, colorMat);
    pad.position.set(cx, top + 0.78, cz);
    pad.castShadow = true;
    group.add(pad);

    for (const h of RING.ropeHeights) {
      const buckle = new THREE.Mesh(buckleGeo, colorMat);
      buckle.position.set(cx, top + h, cz);
      group.add(buckle);
    }
  });

  const ropeMaterials = [
    keep(new THREE.MeshStandardMaterial({ color: 0xf3efe4, roughness: 0.72 })),
    keep(new THREE.MeshStandardMaterial({ color: 0xd9413a, roughness: 0.72 })),
    keep(new THREE.MeshStandardMaterial({ color: 0xf3efe4, roughness: 0.72 })),
    keep(new THREE.MeshStandardMaterial({ color: 0x2f6fe0, roughness: 0.72 })),
  ];

  const ropeHeights = RING.ropeHeights;
  for (let s = 0; s < 4; s++) {
    const a = corners[s];
    const b = corners[(s + 1) % 4];
    for (let r = 0; r < ropeHeights.length; r++) {
      const h = top + ropeHeights[r];
      const p0 = new THREE.Vector3(a[0], h, a[1]);
      const p1 = new THREE.Vector3((a[0] + b[0]) / 2, h - RING.ropeSag, (a[1] + b[1]) / 2);
      const p2 = new THREE.Vector3(b[0], h, b[1]);
      const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
      const geo = keep(new THREE.TubeGeometry(curve, 22, RING.ropeRadius, 7, false));
      const rope = new THREE.Mesh(geo, ropeMaterials[r]);
      rope.castShadow = true;
      group.add(rope);
    }
  }

  /* ---------------- steps ---------------- */
  const stepMat = keep(new THREE.MeshStandardMaterial({ color: 0x1d2436, roughness: 0.7, metalness: 0.2 }));
  const trimMat = keep(new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5, metalness: 0.4 }));
  const steps = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const w = 2.0 - i * 0.34;
    const h = top / 3;
    const g = keep(new THREE.BoxGeometry(w, h, 0.36));
    const step = new THREE.Mesh(g, stepMat);
    step.position.set(0, h / 2 + i * h, platformHalf + 0.18 + i * 0.36);
    step.castShadow = true;
    step.receiveShadow = true;
    steps.add(step);
    const t = new THREE.Mesh(keep(new THREE.BoxGeometry(w, 0.03, 0.36)), trimMat);
    t.position.set(0, h - 0.01 + i * h, platformHalf + 0.18 + i * 0.36);
    steps.add(t);
  }
  group.add(steps);

  /* ---------------- corner stools ---------------- */
  const stoolMat = keep(new THREE.MeshStandardMaterial({ color: 0x2a2f3d, roughness: 0.6 }));
  const makeStool = (x: number, z: number, color: number) => {
    const stool = new THREE.Group();
    const seat = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 16)), stoolMat);
    seat.position.y = 0.46;
    stool.add(seat);
    const padM = keep(new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
    const pad = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16)), padM);
    pad.position.y = 0.51;
    stool.add(pad);
    for (const [dx, dz] of [
      [0.16, 0.16],
      [-0.16, 0.16],
      [0.16, -0.16],
      [-0.16, -0.16],
    ]) {
      const leg = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.022, 0.022, 0.46, 8)), stoolMat);
      leg.position.set(dx, 0.23, dz);
      stool.add(leg);
    }
    stool.position.set(x, top, z);
    stool.scale.setScalar(1);
    return stool;
  };
  // Corner stools live on the apron, out past the ropes — on the canvas they
  // read as furniture in the middle of the fight.
  const stoolR = half + 0.3;
  group.add(makeStool(-stoolR, -stoolR, 0xd21a14));
  group.add(makeStool(stoolR, stoolR, 0x1f6fe0));

  return {
    group,
    canvasY: top,
    bound: half - RING.combatMargin,
    dispose() {
      for (const t of trash) t.dispose();
    },
  };
}
