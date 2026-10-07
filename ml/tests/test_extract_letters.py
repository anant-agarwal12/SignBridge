import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import extract_letters as ex  # noqa: E402


def make_pose():
    p = np.zeros((33, 3))
    p[ex.L_SHOULDER] = [300, 100, -10]
    p[ex.R_SHOULDER] = [100, 100, -10]
    p[ex.L_WRIST] = [400, 300, -50]
    p[ex.R_WRIST] = [0, 300, -50]
    return p


def make_hand(x, y):
    h = np.zeros((21, 3))
    h[:, 0], h[:, 1] = x, y
    return h


def test_normalize_midpoint_and_width():
    pose = make_pose()
    hand = make_hand(0, 300)
    pose_n, hands_n = ex.normalize(pose, {"right": hand})
    assert np.allclose((pose_n[ex.L_SHOULDER] + pose_n[ex.R_SHOULDER]) / 2, 0)
    assert np.isclose(np.linalg.norm(pose_n[ex.L_SHOULDER] - pose_n[ex.R_SHOULDER]), 1)
    # hand z is shifted onto the pose wrist depth
    assert np.isclose(hands_n["right"][0, 2], pose_n[ex.R_WRIST, 2])


def test_normalize_without_pose_is_none():
    assert ex.normalize(None, {}) is None


def test_assign_sides_by_nearest_wrist():
    pose = make_pose()
    sides = ex.assign_sides(
        [make_hand(10, 290), make_hand(390, 310)], ["Left", "Left"], pose
    )
    assert (
        sides["right"][0, 0] == 10
    )  # image-left hand is the signer's right (facing camera)
    assert sides["left"][0, 0] == 390


def test_assign_sides_label_fallback_is_inverted():
    sides = ex.assign_sides([make_hand(1, 1)], ["Left"], None)
    assert list(sides) == ["right"]


def test_make_clip_shape():
    clip = ex.make_clip(make_pose(), {"right": make_hand(0, 0)})
    f = clip["frames"][0]
    assert (
        len(f["pose"]) == 33 and len(f["right_hand"]) == 21 and f["left_hand"] is None
    )
