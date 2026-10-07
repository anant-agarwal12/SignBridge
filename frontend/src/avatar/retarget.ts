/**
 * Converts one clip frame (see docs/clip-format.md) into VRM humanoid bone rotations.
 *
 * Pure math, no three.js: quaternions are [x, y, z, w] tuples, so the result can be
 * applied with `node.quaternion.set(...q)` on a VRM normalized humanoid.
 *
 * Assumptions (tune against the real avatar):
 *  - Normalized VRM humanoid in T-pose: all bones have identity rotation, arms along +/-x,
 *    palms down, thumbs forward (+z), fingers straight along the arm axis.
 *  - Clip space is MediaPipe-like (y down, z away from camera); VRM is y up, facing +z.
 *    We map (x, y, z) -> (x, -y, -z). The signer's left is VRM +x (leftUpperArm).
 *  - Segment rotations are shortest-arc (no twist), except hands, which use the palm plane.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export interface ClipFrame {
  pose: Vec3[] | null;
  left_hand: Vec3[] | null;
  right_hand: Vec3[] | null;
}

/** VRM humanoid bone name -> local rotation. */
export type BoneRotations = Record<string, Quat>;

const IDENTITY: Quat = [0, 0, 0, 1];
const EPS = 1e-8;

// ---- vector helpers -------------------------------------------------------

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

function normalize(a: Vec3): Vec3 | null {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l < EPS ? null : scale(a, 1 / l);
}

/** Clip space -> VRM space (proper rotation: y up, avatar faces +z). */
const toVrm = (p: Vec3): Vec3 => [p[0], -p[1], -p[2]];

// ---- quaternion helpers ---------------------------------------------------

function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

const qInv = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]]; // unit quaternions only

function qNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l < EPS ? IDENTITY : [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Shortest-arc rotation taking unit vector `from` to unit vector `to`. */
export function arc(from: Vec3, to: Vec3): Quat {
  const d = dot(from, to);
  if (d < -1 + 1e-6) {
    // Opposite vectors: rotate 180 degrees about any axis perpendicular to `from`.
    const axis = normalize(cross(from, Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])) as Vec3;
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(from, to);
  return qNormalize([c[0], c[1], c[2], 1 + d]);
}

/** Rotation matrix (given as columns) -> unit quaternion. */
function matToQuat(c0: Vec3, c1: Vec3, c2: Vec3): Quat {
  const [m00, m10, m20] = c0;
  const [m01, m11, m21] = c1;
  const [m02, m12, m22] = c2;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return qNormalize(q);
}

type Basis = [Vec3, Vec3, Vec3]; // [forward, up, side], right-handed

/** Orthonormal basis from a forward vector and an "up" hint. Null if degenerate. */
function basis(forward: Vec3, upHint: Vec3): Basis | null {
  const f = normalize(forward);
  if (!f) return null;
  const u = normalize(sub(upHint, scale(f, dot(upHint, f))));
  if (!u) return null;
  return [f, u, cross(f, u)];
}

/** Rotation R with R * rest[i] = target[i] for each basis vector. */
function basisRotation(rest: Basis, target: Basis): Quat {
  const apply = (e: Vec3): Vec3 => {
    const r: Vec3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const w = dot(rest[i], e);
      r[0] += target[i][0] * w;
      r[1] += target[i][1] * w;
      r[2] += target[i][2] * w;
    }
    return r;
  };
  return matToQuat(apply([1, 0, 0]), apply([0, 1, 0]), apply([0, 0, 1]));
}

// ---- landmark layout ------------------------------------------------------

const FINGERS: { name: string; joints: number[]; bones: [string, string, string] }[] = [
  { name: "thumb", joints: [1, 2, 3, 4], bones: ["ThumbMetacarpal", "ThumbProximal", "ThumbDistal"] },
  { name: "index", joints: [5, 6, 7, 8], bones: ["IndexProximal", "IndexIntermediate", "IndexDistal"] },
  { name: "middle", joints: [9, 10, 11, 12], bones: ["MiddleProximal", "MiddleIntermediate", "MiddleDistal"] },
  { name: "ring", joints: [13, 14, 15, 16], bones: ["RingProximal", "RingIntermediate", "RingDistal"] },
  { name: "pinky", joints: [17, 18, 19, 20], bones: ["LittleProximal", "LittleIntermediate", "LittleDistal"] },
];

interface SideSpec {
  side: "left" | "right";
  armDir: Vec3; // rest direction of the arm in VRM space (T-pose)
  shoulder: number;
  elbow: number;
  wrist: number;
}

const SIDES: SideSpec[] = [
  { side: "left", armDir: [1, 0, 0], shoulder: 11, elbow: 13, wrist: 15 },
  { side: "right", armDir: [-1, 0, 0], shoulder: 12, elbow: 14, wrist: 16 },
];

/** Rest hand basis in T-pose: fingers along the arm, back of hand up (+y). */
function restHandBasis(armDir: Vec3): Basis {
  const up: Vec3 = [0, 1, 0];
  return [armDir, up, cross(armDir, up)];
}

// ---- main -----------------------------------------------------------------

/**
 * Compute local bone rotations for every bone that can be derived from `frame`.
 * Bones with no usable landmarks are omitted (callers keep their idle pose).
 * Every returned quaternion is a unit quaternion.
 */
export function retargetFrame(frame: ClipFrame): BoneRotations {
  const out: BoneRotations = {};

  for (const spec of SIDES) {
    const { side } = spec;
    const hand = side === "left" ? frame.left_hand : frame.right_hand;
    let armWorld: Quat = IDENTITY; // world rotation of the bone the hand hangs from

    if (frame.pose) {
      const shoulder = toVrm(frame.pose[spec.shoulder]);
      const elbow = toVrm(frame.pose[spec.elbow]);
      const wrist = toVrm(frame.pose[spec.wrist]);
      const upperDir = normalize(sub(elbow, shoulder));
      const lowerDir = normalize(sub(wrist, elbow));
      if (upperDir) {
        const upperWorld = arc(spec.armDir, upperDir);
        out[`${side}UpperArm`] = upperWorld;
        armWorld = upperWorld;
        if (lowerDir) {
          const lowerWorld = arc(spec.armDir, lowerDir);
          out[`${side}LowerArm`] = qNormalize(qMul(qInv(upperWorld), lowerWorld));
          armWorld = lowerWorld;
        }
      }
    }

    if (!hand) continue;
    const p = hand.map(toVrm);

    // Hand orientation from the palm plane: wrist -> middle MCP, and index MCP -> pinky MCP.
    // cross(forward, across) is the back-of-hand direction for the left hand and the palm
    // direction for the right hand (anatomy mirrored in x), hence the sign flip for `right`.
    const forward = sub(p[9], p[0]);
    const normal = cross(forward, sub(p[17], p[5]));
    const target = basis(forward, side === "left" ? normal : scale(normal, -1));
    let handWorld = armWorld;
    if (target) {
      handWorld = basisRotation(restHandBasis(spec.armDir), target);
      out[`${side}Hand`] = qNormalize(qMul(qInv(armWorld), handWorld));
    }

    // Fingers: each segment is the shortest arc from the rest direction (along the arm)
    // to its landmark direction, expressed relative to its parent segment.
    for (const finger of FINGERS) {
      let parentWorld = handWorld;
      for (let i = 0; i < 3; i++) {
        const dir = normalize(sub(p[finger.joints[i + 1]], p[finger.joints[i]]));
        if (!dir) break;
        const world = arc(spec.armDir, dir);
        out[`${side}${finger.bones[i]}`] = qNormalize(qMul(qInv(parentWorld), world));
        parentWorld = world;
      }
    }
  }

  return out;
}

/** Spherical interpolation between two unit quaternions (shortest path). */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) {
    bb = [-b[0], -b[1], -b[2], -b[3]];
    d = -d;
  }
  if (d > 0.9995) {
    return qNormalize([
      a[0] + (bb[0] - a[0]) * t,
      a[1] + (bb[1] - a[1]) * t,
      a[2] + (bb[2] - a[2]) * t,
      a[3] + (bb[3] - a[3]) * t,
    ]);
  }
  const theta = Math.acos(d);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return [
    a[0] * wa + bb[0] * wb,
    a[1] * wa + bb[1] * wb,
    a[2] * wa + bb[2] * wb,
    a[3] * wa + bb[3] * wb,
  ];
}
