import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Joint, Vec3 } from "../core/types";
import bruteUrl from "../../assets/raw/Brute.glb?url";

/**
 * Photoreal boxer body, retargeted from a skinned Mixamo character.
 *
 * The download is a plain T-posed armature with no animation. Rather than
 * trying to author clips for its 72-bone skeleton, its bones are *conformed*
 * to the game rig: every bone is moved onto the matching game joint and every
 * frame its local rotation is rebuilt from the game pose.
 *
 * Because a bone's contribution to skinning is `world * inverse(bindWorld)`,
 * asking the bone for a world rotation of `P * K * bind` makes the mesh rotate
 * by exactly `P * K` about the bind pose, where `P` is the accumulated game
 * pose and `K` is a constant "rest correction" (the T-posed arms have to be
 * folded down before they line up with the game's hanging rest pose). Solving
 * the parent/child relation for the local rotation collapses to
 *
 *     bone.quaternion = (K_parent * bind_parent)^-1 * P_local * (K_self * bind_self)
 *
 * which needs no runtime chain accumulation and is exact, not approximate.
 * Bone offsets are rebased with the same argument applied to translation.
 */

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

/** Game joint -> Mixamo bone (suffix match, so `mixamorig:` prefixes are fine). */
const BONE_OF: Array<[Joint, string]> = [
  ["hips", "Hips"],
  ["spine", "Spine"],
  ["chest", "Spine2"],
  ["neck", "Neck"],
  ["head", "Head"],
  ["shoulderL", "LeftShoulder"],
  ["upperArmL", "LeftArm"],
  ["foreArmL", "LeftForeArm"],
  ["handL", "LeftHand"],
  ["shoulderR", "RightShoulder"],
  ["upperArmR", "RightArm"],
  ["foreArmR", "RightForeArm"],
  ["handR", "RightHand"],
  ["upperLegL", "LeftUpLeg"],
  ["lowerLegL", "LeftLeg"],
  ["footL", "LeftFoot"],
  ["upperLegR", "RightUpLeg"],
  ["lowerLegR", "RightLeg"],
  ["footR", "RightFoot"],
];

/** Mirrors the game rig's own tree exactly. */
const PARENT_OF: Partial<Record<Joint, Joint>> = {
  spine: "hips",
  chest: "spine",
  neck: "chest",
  head: "neck",
  shoulderL: "chest",
  shoulderR: "chest",
  upperArmL: "shoulderL",
  upperArmR: "shoulderR",
  foreArmL: "upperArmL",
  foreArmR: "upperArmR",
  handL: "foreArmL",
  handR: "foreArmR",
  upperLegL: "hips",
  upperLegR: "hips",
  lowerLegL: "upperLegL",
  lowerLegR: "upperLegR",
  footL: "lowerLegL",
  footR: "lowerLegR",
};

/** Joint used to orient a bone: the bone's own axis points at its child. */
const DIR_CHILD: Partial<Record<Joint, Joint>> = {
  hips: "spine",
  spine: "chest",
  chest: "neck",
  neck: "head",
  shoulderL: "upperArmL",
  shoulderR: "upperArmR",
  upperArmL: "foreArmL",
  upperArmR: "foreArmR",
  foreArmL: "handL",
  foreArmR: "handR",
  upperLegL: "lowerLegL",
  upperLegR: "lowerLegR",
  lowerLegL: "footL",
  lowerLegR: "footR",
};

/** Garments/accessories the game replaces with its own geometry. */
const DROP = [/axe/i, /shoes/i];

/** The model's trousers stand in for bare legs once re-materialled. */
const LEGS = /bottoms/i;

function key(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* ------------------------------------------------------------------ */
/* Template                                                            */
/* ------------------------------------------------------------------ */

export interface BoxerTemplate {
  /** Pristine T-posed source; clone per fighter. */
  scene: THREE.Object3D;
  /** Bind-pose height and floor level, in metres. */
  height: number;
  minY: number;
  /** Average albedo of the skin texture, so add-ons can match it. */
  skin: THREE.Color;
}

/**
 * Averages the body textures into one skin tone. Outliers (shadow, highlights,
 * matte black) are skipped so the result reads as mid-tone flesh.
 */
function averageSkinColor(mat: THREE.Material | null): THREE.Color | null {
  const map = (mat as THREE.MeshStandardMaterial | null)?.map;
  const img = map?.image as CanvasImageSource | undefined;
  if (!img) return null;
  try {
    const size = 48;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const c2d = canvas.getContext("2d", { willReadFrequently: true });
    if (!c2d) return null;
    c2d.drawImage(img, 0, 0, size, size);
    const px = c2d.getImageData(0, 0, size, size).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      if (lum < 28 || lum > 236) continue;
      r += px[i];
      g += px[i + 1];
      b += px[i + 2];
      n++;
    }
    if (n < 24) return null;
    return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch {
    return null;
  }
}

let cached: BoxerTemplate | null = null;
let pending: Promise<BoxerTemplate> | null = null;

/** Loads the boxer mesh once and keeps it around for every fighter. */
export function loadBoxerTemplate(): Promise<BoxerTemplate> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = new GLTFLoader().loadAsync(bruteUrl).then((gltf) => {
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);

      // Feet-to-crown span of the *whole* figure, boots included: that is
      // what the floor and the target height are measured against.
      const box = new THREE.Box3();
      let bodyMat: THREE.Material | null = null;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || /axe/i.test(m.name)) return;
        const geo = m.geometry as THREE.BufferGeometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        // glTF binds skinned meshes with an identity bind matrix, so this
        // geometry is already in skin space — the node transform must *not*
        // be applied (the renderer cancels it out).
        box.union(geo.boundingBox!);
        for (const material of Array.isArray(m.material) ? m.material : [m.material]) {
          if (/^body/i.test(material.name)) bodyMat = material;
        }
      });

      const span = box.max.y - box.min.y;
      cached = {
        scene,
        height: span > 0.05 ? span : 1,
        minY: box.min.y,
        skin: averageSkinColor(bodyMat) ?? new THREE.Color(0.52, 0.34, 0.25),
      };
      return cached;
    });
  }
  return pending;
}

/* ------------------------------------------------------------------ */
/* Instance                                                            */
/* ------------------------------------------------------------------ */

export interface BoxerBody {
  /** Node to hang under the fighter's rig root. */
  object: THREE.Object3D;
  /** Rest positions of every game joint, in the rig root's frame (metres). */
  layout: Partial<Record<Joint, THREE.Vector3>>;
  /** Rest length of the shoulder-to-hand chain, metres. */
  reach: number;
  /** Retarget hook consumed by `Animator.apply`. */
  setJoint(joint: Joint, euler: Vec3): boolean;
  dispose(): void;
}

interface Entry {
  bone: THREE.Bone;
  /** (K_parent * bindRot_parent)^-1 */
  parentInv: THREE.Quaternion;
  /** K_self * bindRot_self */
  self: THREE.Quaternion;
}

const _euler = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Builds one animatable fighter body.
 *
 * @param tpl        loaded template
 * @param height     target total height in metres (floor to crown)
 * @param skinTint   gentle multiply tint for the body texture, 0..1 lightness
 */
export function createBoxer(tpl: BoxerTemplate, height: number, skinTint?: THREE.Color): BoxerBody {
  const scene = cloneSkinned(tpl.scene);
  scene.updateMatrixWorld(true);

  const scale = height / tpl.height;
  const lift = -tpl.minY;

  /* -- locate bones, capture the bind pose ------------------------- */
  const chain: THREE.Bone[] = [];
  const byKey = new Map<string, THREE.Bone>();
  scene.traverse((o) => {
    const b = o as THREE.Bone;
    if (!b.isBone) return;
    chain.push(b); // a parent always precedes its children
    byKey.set(key(b.name), b);
  });

  const boneOf = new Map<Joint, THREE.Bone>();
  for (const [joint, name] of BONE_OF) {
    const want = key(name);
    let bone = byKey.get(want) ?? null;
    if (!bone) {
      for (const [k, b] of byKey) {
        if (k.endsWith(want)) {
          bone = b;
          break;
        }
      }
    }
    if (bone) boneOf.set(joint, bone);
  }

  const jointOf = new Map<THREE.Bone, Joint>();
  for (const [joint, bone] of boneOf) jointOf.set(bone, joint);

  const bindPos = new Map<THREE.Bone, THREE.Vector3>();
  const bindRot = new Map<THREE.Bone, THREE.Quaternion>();
  const bindScale = new Map<THREE.Bone, number>();
  for (const b of chain) {
    b.matrixWorld.decompose(_v, _q, _s);
    // Everything is authored in a frame whose floor is y = 0; the model's
    // own floor sits at tpl.minY, so the whole bind pose rides up onto it.
    bindPos.set(b, _v.clone().setY(_v.y + lift));
    bindRot.set(b, _q.clone());
    bindScale.set(b, _s.x);
  }

  const jpos = (j: Joint) => bindPos.get(boneOf.get(j)!)!;
  const jrot = (j: Joint) => bindRot.get(boneOf.get(j)!)!;

  /* -- rest layout: bind pose with the T-posed arms folded down ---- */
  const layout = new Map<Joint, THREE.Vector3>();
  for (const [joint, bone] of boneOf) layout.set(joint, bindPos.get(bone)!.clone());
  for (const side of ["L", "R"] as const) {
    const upper = `upperArm${side}` as Joint;
    const fore = `foreArm${side}` as Joint;
    const hand = `hand${side}` as Joint;
    const upperLen = layout.get(upper)!.distanceTo(layout.get(fore)!);
    const foreLen = layout.get(fore)!.distanceTo(layout.get(hand)!);
    const root = layout.get(upper)!;
    layout.set(fore, new THREE.Vector3(root.x, root.y - upperLen, root.z));
    layout.set(hand, new THREE.Vector3(root.x, root.y - upperLen - foreLen, root.z));
  }

  /* -- rest correction K: bind bone axis -> game rest bone axis ---- */
  const rest = new Map<Joint, THREE.Quaternion>();
  for (const [joint] of boneOf) {
    const child = DIR_CHILD[joint];
    const parent = PARENT_OF[joint];
    let bindDir: THREE.Vector3;
    let restDir: THREE.Vector3;
    if (child) {
      bindDir = jpos(child).clone().sub(jpos(joint));
      restDir = layout.get(child)!.clone().sub(layout.get(joint)!);
    } else if (parent) {
      bindDir = jpos(joint).clone().sub(jpos(parent));
      restDir = layout.get(joint)!.clone().sub(layout.get(parent)!);
    } else {
      rest.set(joint, new THREE.Quaternion());
      continue;
    }
    if (bindDir.lengthSq() < 1e-12 || restDir.lengthSq() < 1e-12) {
      rest.set(joint, new THREE.Quaternion());
      continue;
    }
    rest.set(
      joint,
      new THREE.Quaternion().setFromUnitVectors(bindDir.normalize(), restDir.normalize()),
    );
  }

  const E = new Map<Joint, THREE.Quaternion>();
  for (const [joint] of boneOf) {
    E.set(joint, rest.get(joint)!.clone().multiply(jrot(joint)));
  }

  /* -- rest world transforms for every bone ------------------------ */
  // The rig only redesigns the joints it owns, but bones hang off other bones,
  // so each one needs a rest transform to express child offsets against.
  const restRot = new Map<THREE.Object3D, THREE.Quaternion>();
  const restPos = new Map<THREE.Object3D, THREE.Vector3>();
  const restScale = new Map<THREE.Object3D, number>();

  const nodeRest = (o: THREE.Object3D) => {
    if (restRot.has(o)) return;
    // Anything above the skeleton (the armature) keeps its bind pose.
    o.matrixWorld.decompose(_v, _q, _s);
    restRot.set(o, _q.clone());
    restPos.set(o, _v.clone());
    restScale.set(o, _s.x);
  };

  for (const b of chain) {
    const p = b.parent as THREE.Bone;
    nodeRest(p);
    const pRot = restRot.get(p)!;
    const pBind = bindRot.get(p);
    const joint = jointOf.get(b);
    if (joint) {
      restRot.set(b, E.get(joint)!);
      restPos.set(b, layout.get(joint)!);
      restScale.set(b, bindScale.get(b)!);
      continue;
    }
    if (!p.isBone || !pBind) {
      // No bone above it: its own bind transform still holds.
      restRot.set(b, bindRot.get(b)!);
      restPos.set(b, bindPos.get(b)!);
    } else {
      // Pass-through bone: bind-local transform, carried by its parent.
      const acc = pRot.clone().multiply(pBind.clone().invert());
      restRot.set(b, acc.clone().multiply(bindRot.get(b)!));
      restPos.set(
        b,
        restPos.get(p)!.clone().add(bindPos.get(b)!.clone().sub(bindPos.get(p)!).applyQuaternion(acc)),
      );
    }
    restScale.set(b, restScale.get(p)!);
  }

  /* -- rebase the bones onto the game joint positions -------------- */
  for (const [joint, bone] of boneOf) {
    const p = bone.parent as THREE.Object3D;
    const offset = layout.get(joint)!.clone().sub(restPos.get(p)!);
    offset.applyQuaternion(restRot.get(p)!.clone().invert());
    const parentScale = restScale.get(p)!;
    if (parentScale > 1e-6) offset.divideScalar(parentScale);
    bone.position.copy(offset);
  }

  /* -- fold the fingers into fists --------------------------------- */
  // Nothing poses finger bones and the source model's hands are wide open, so
  // without this they spill straight through the gloves. Each finger folds
  // about the palm normal — the layout frame's Z axis — and, since the fold is
  // applied down the chain, each joint only needs its own share of the curl.
  const FINGER = /(thumb|index|middle|ring|pinky)([123])$/;
  const folds = new Map<THREE.Bone, number>();
  for (const [joint, handBone] of boneOf) {
    const side = joint === "handL" ? -1 : joint === "handR" ? 1 : 0;
    if (!side) continue;
    handBone.traverse((o) => {
      const b = o as THREE.Bone;
      if (!b.isBone || b === handBone) return;
      const m = FINGER.exec(key(b.name));
      if (!m) return;
      const seg = +m[2];
      const thumb = m[1] === "thumb";
      // Thumbs tuck across the fingers, so they fold the opposite way round.
      const amt = thumb ? [0, 0.5, 0.6, 0.4][seg] : [0, 1.45, 1.75, 1.15][seg];
      folds.set(b, (thumb ? -side : side) * amt);
    });
  }
  if (folds.size) {
    const cur = new Map<THREE.Object3D, THREE.Quaternion>();
    const axis = new THREE.Vector3(0, 0, 1);
    for (const b of chain) {
      const p = b.parent as THREE.Object3D;
      let pRot = cur.get(p);
      if (!pRot) {
        pRot = bindRot.get(p as THREE.Bone)?.clone() ?? p.getWorldQuaternion(new THREE.Quaternion());
        cur.set(p, pRot);
      }
      const amt = folds.get(b);
      if (amt) {
        const fold = new THREE.Quaternion().setFromAxisAngle(axis, amt);
        b.quaternion.copy(pRot.clone().invert().multiply(fold).multiply(pRot).multiply(b.quaternion));
      }
      cur.set(b, pRot.clone().multiply(b.quaternion));
    }
  }

  /* -- assemble ---------------------------------------------------- */
  for (const [, bone] of boneOf) {
    bone.updateMatrix();
    bone.matrixAutoUpdate = true;
  }

  const root = new THREE.Group();
  root.name = "boxerBody";
  root.scale.setScalar(scale);

  const drop: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && DROP.some((re) => re.test(m.name))) drop.push(m);
  });
  for (const d of drop) d.removeFromParent();

  root.add(scene);

  /* -- runtime retarget ------------------------------------------- */
  const entries = new Map<Joint, Entry>();
  for (const [joint, bone] of boneOf) {
    entries.set(joint, {
      bone,
      parentInv: restRot.get(bone.parent as THREE.Object3D)!.clone().invert(),
      self: E.get(joint)!,
    });
  }

  const materials: THREE.MeshStandardMaterial[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = false;
    m.frustumCulled = false;
    // SkeletonUtils.clone shares materials between instances; give this
    // fighter its own so tinting and disposal stay independent.
    const own = (Array.isArray(m.material) ? m.material : [m.material]).map((src) => {
      const copy = src.clone() as THREE.MeshStandardMaterial;
      materials.push(copy);
      return copy;
    });
    m.material = Array.isArray(m.material) ? own : own[0];
    for (const c of own) {
      if (/^body/i.test(c.name)) {
        // Skin is a dielectric; the asset's 0.5 metalness just muddies it.
        c.metalness = 0;
        c.roughness = 0.68;
        if (skinTint) c.color.multiply(skinTint);
      }
      if (LEGS.test(m.name)) {
        // The model's trousers are the only leg geometry there is, so they
        // become bare legs: same tone as the skin texture, no cloth detail.
        c.map = null;
        c.normalMap = null;
        c.metalness = 0;
        c.roughness = 0.68;
        c.color.copy(tpl.skin);
        if (skinTint) c.color.multiply(skinTint);
      }
    }
  });

  const plainLayout: Partial<Record<Joint, THREE.Vector3>> = {};
  for (const [joint, p] of layout) {
    plainLayout[joint] = p.clone().multiplyScalar(scale);
  }

  const upperArm = layout.get("upperArmL")!;
  const handEnd = layout.get("handL")!;

  return {
    object: root,
    layout: plainLayout,
    reach: upperArm.distanceTo(handEnd) * scale,
    setJoint(joint: Joint, euler: Vec3): boolean {
      const entry = entries.get(joint);
      if (!entry) return false;
      _euler.set(euler[0], euler[1], euler[2], "XYZ");
      _q.setFromEuler(_euler);
      entry.bone.quaternion.copy(entry.parentInv).multiply(_q).multiply(entry.self);
      return true;
    },
    dispose() {
      for (const m of materials) m.dispose();
    },
  };
}
