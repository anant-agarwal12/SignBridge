import { describe, expect, it } from "vitest";
import { arc, type ClipFrame, type Quat, retargetFrame, slerp, type Vec3 } from "./retarget";

const norm = (q: Quat) => Math.hypot(q[0], q[1], q[2], q[3]);
const expectQuat = (q: Quat, e: Quat) => {
  // q and -q are the same rotation
  const sign = q[0] * e[0] + q[1] * e[1] + q[2] * e[2] + q[3] * e[3] < 0 ? -1 : 1;
  q.forEach((v, i) => expect(v * sign).toBeCloseTo(e[i], 5));
};

/** Pose landmarks: only 11-16 matter, the rest are zeros. Clip space: y down, z away. */
function pose(overrides: Record<number, Vec3>): Vec3[] {
  const p: Vec3[] = Array.from({ length: 33 }, () => [0, 0, 0]);
  for (const [i, v] of Object.entries(overrides)) p[Number(i)] = v;
  return p;
}

// T-pose, signer facing camera: shoulders 1 unit apart, arms straight out sideways.
const T_POSE = pose({
  11: [0.5, 0, 0], // left shoulder (image right)
  12: [-0.5, 0, 0],
  13: [1.5, 0, 0],
  14: [-1.5, 0, 0],
  15: [2.5, 0, 0],
  16: [-2.5, 0, 0],
});

/**
 * Hand-written left hand, wrist at (2.5, 0, 0), fingers straight along +x, palm down,
 * thumb toward the camera (-z in clip space). Each finger is 3 segments of 0.1.
 */
const STRAIGHT_LEFT_HAND: Vec3[] = [
  [2.5, 0, 0], // 0 wrist
  [2.55, 0, -0.05], [2.6, 0, -0.08], [2.65, 0, -0.1], [2.7, 0, -0.1], // thumb
  [2.7, 0, -0.04], [2.8, 0, -0.04], [2.9, 0, -0.04], [3.0, 0, -0.04], // index
  [2.7, 0, 0], [2.8, 0, 0], [2.9, 0, 0], [3.0, 0, 0], // middle
  [2.7, 0, 0.03], [2.8, 0, 0.03], [2.9, 0, 0.03], [3.0, 0, 0.03], // ring
  [2.7, 0, 0.06], [2.8, 0, 0.06], [2.9, 0, 0.06], [3.0, 0, 0.06], // pinky
];

/** Same hand but the index finger curls down (clip +y) after the MCP. */
const CURLED_INDEX_HAND: Vec3[] = STRAIGHT_LEFT_HAND.map((p, i): Vec3 => {
  if (i === 6) return [2.8, 0.05, -0.04];
  if (i === 7) return [2.85, 0.15, -0.04];
  if (i === 8) return [2.8, 0.22, -0.04];
  return p;
});

const SAMPLE: ClipFrame = {
  // left elbow bent: forearm points up (clip -y) and a bit forward (clip -z)
  pose: pose({
    11: [0.5, 0, 0],
    12: [-0.5, 0, 0],
    13: [1.5, 0.2, 0],
    14: [-1.5, 0, 0],
    15: [1.6, -0.8, -0.4],
    16: [-2.5, 0, 0],
  }),
  left_hand: CURLED_INDEX_HAND.map((p): Vec3 => [p[0] - 0.9, p[1] - 0.8, p[2] - 0.4]),
  right_hand: null,
};

describe("retargetFrame", () => {
  it("returns unit quaternions for every bone of a sample frame", () => {
    const bones = retargetFrame(SAMPLE);
    const names = Object.keys(bones);
    expect(names).toContain("leftUpperArm");
    expect(names).toContain("leftLowerArm");
    expect(names).toContain("leftHand");
    expect(names).toContain("leftIndexProximal");
    expect(names).toContain("leftLittleDistal");
    expect(names).toContain("leftThumbMetacarpal");
    expect(names.length).toBe(2 + 1 + 15 + 2); // right arm bones from pose too
    for (const [name, q] of Object.entries(bones)) {
      expect(norm(q), name).toBeCloseTo(1, 6);
      q.forEach((v) => expect(Number.isFinite(v)).toBe(true));
    }
  });

  it("gives identity rotations for a straight T-pose", () => {
    const bones = retargetFrame({ pose: T_POSE, left_hand: STRAIGHT_LEFT_HAND, right_hand: null });
    for (const name of ["leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightLowerArm"]) {
      expectQuat(bones[name], [0, 0, 0, 1]);
    }
    for (const name of ["leftIndexProximal", "leftMiddleDistal", "leftRingIntermediate"]) {
      expectQuat(bones[name], [0, 0, 0, 1]);
    }
  });

  it("rotates the left upper arm down by 90 degrees about -z when the elbow drops", () => {
    // clip +y is down, so elbow at (0.5, 1, 0) hangs straight down.
    const frame: ClipFrame = {
      pose: pose({ 11: [0.5, 0, 0], 12: [-0.5, 0, 0], 13: [0.5, 1, 0], 15: [0.5, 2, 0] }),
      left_hand: null,
      right_hand: null,
    };
    const s = Math.SQRT1_2;
    expectQuat(retargetFrame(frame).leftUpperArm, [0, 0, -s, s]);
  });

  it("curls only the index finger distal chain in the curled-hand fixture", () => {
    const bones = retargetFrame({ pose: T_POSE, left_hand: CURLED_INDEX_HAND, right_hand: null });
    expect(Math.abs(bones.leftIndexIntermediate[3])).toBeLessThan(0.9999);
    expectQuat(bones.leftMiddleProximal, [0, 0, 0, 1]);
  });

  it("omits bones whose landmarks are missing", () => {
    expect(retargetFrame({ pose: null, left_hand: null, right_hand: null })).toEqual({});
    const handOnly = retargetFrame({ pose: null, left_hand: STRAIGHT_LEFT_HAND, right_hand: null });
    expect(handOnly.leftUpperArm).toBeUndefined();
    expect(handOnly.leftHand).toBeDefined();
    expect(handOnly.rightHand).toBeUndefined();
  });

  it("does not emit NaN for degenerate landmarks", () => {
    const zeros: Vec3[] = Array.from({ length: 21 }, () => [0, 0, 0]);
    const bones = retargetFrame({ pose: pose({}), left_hand: zeros, right_hand: zeros });
    for (const q of Object.values(bones)) q.forEach((v) => expect(Number.isFinite(v)).toBe(true));
  });
});

describe("arc / slerp", () => {
  it("arc handles opposite vectors with a unit quaternion", () => {
    const q = arc([1, 0, 0], [-1, 0, 0]);
    expect(norm(q)).toBeCloseTo(1, 6);
  });

  it("slerp hits endpoints and stays unit length", () => {
    const a: Quat = [0, 0, 0, 1];
    const b = arc([1, 0, 0], [0, 1, 0]);
    expectQuat(slerp(a, b, 0), a);
    expectQuat(slerp(a, b, 1), b);
    expect(norm(slerp(a, b, 0.4))).toBeCloseTo(1, 6);
  });
});
