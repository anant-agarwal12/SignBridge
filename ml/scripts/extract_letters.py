"""Extract one-frame clips (docs/clip-format.md) from fingerspelling letter photos.

Reads  <data-dir>/{asl,isl}/<LETTER>.jpg
Writes <out-dir>/{lang}/<LETTER>.json  (default: backend/app/static/letters)
and prints a report of letters with missing hands.

Requires mediapipe==0.10.21 (legacy `mp.solutions` API with bundled models), opencv-python, numpy.
"""

from __future__ import annotations

import argparse
import json
import string
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parents[2]
LANGS = ("asl", "isl")
L_SHOULDER, R_SHOULDER = 11, 12
L_WRIST, R_WRIST = 15, 16
# Hands expected per language, used only for the report.
EXPECTED_HANDS = {"asl": ("right",), "isl": ("left", "right")}


def to_array(landmarks, width: int, height: int) -> np.ndarray:
    """MediaPipe landmarks (normalized image coords) -> (N, 3) isotropic pixel-ish units."""
    return np.array(
        [[lm.x * width, lm.y * height, lm.z * width] for lm in landmarks], dtype=float
    )


def normalize(
    pose: np.ndarray | None, hands: dict[str, np.ndarray]
) -> tuple[np.ndarray | None, dict[str, np.ndarray]] | None:
    """Shift to the shoulder midpoint and divide by shoulder width. None if no pose."""
    if pose is None:
        return None
    mid = (pose[L_SHOULDER] + pose[R_SHOULDER]) / 2
    width = np.linalg.norm(pose[L_SHOULDER] - pose[R_SHOULDER])
    if width < 1e-6:
        return None
    out_hands = {}
    for side, pts in hands.items():
        pts = pts.copy()
        # Hand z is relative to its own wrist; shift it onto the pose wrist depth.
        wrist = pose[L_WRIST if side == "left" else R_WRIST]
        pts[:, 2] += wrist[2] - pts[0, 2]
        out_hands[side] = (pts - mid) / width
    return (pose - mid) / width, out_hands


def assign_sides(
    hands: list[np.ndarray], handedness: list[str], pose: np.ndarray | None
) -> dict[str, np.ndarray]:
    """Map detected hands to the signer's anatomical left/right.

    With a pose, each hand goes to the nearer pose wrist (robust for un-mirrored photos).
    Without one, fall back to MediaPipe's label, which assumes a mirrored selfie image, so for
    an un-mirrored photo the label is the opposite of the signer's hand.
    """
    sides: dict[str, np.ndarray] = {}
    if pose is not None:
        for pts in sorted(hands, key=lambda h: h[0, 0]):
            d_left = np.linalg.norm(pts[0, :2] - pose[L_WRIST, :2])
            d_right = np.linalg.norm(pts[0, :2] - pose[R_WRIST, :2])
            side = "left" if d_left < d_right else "right"
            if side in sides:  # both hands nearest the same wrist: use the other side
                side = "right" if side == "left" else "left"
            sides.setdefault(side, pts)
        return sides
    for pts, label in zip(hands, handedness, strict=True):
        side = "right" if label == "Left" else "left"
        sides.setdefault(side, pts)
    return sides


def detect(
    image_bgr: np.ndarray, hands_model, pose_model
) -> tuple[np.ndarray | None, list, list]:
    h, w = image_bgr.shape[:2]
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    pose_res = pose_model.process(rgb)
    pose = (
        to_array(pose_res.pose_landmarks.landmark, w, h)
        if pose_res.pose_landmarks
        else None
    )
    hand_res = hands_model.process(rgb)
    hands, labels = [], []
    for lms, hd in zip(
        hand_res.multi_hand_landmarks or [],
        hand_res.multi_handedness or [],
        strict=False,
    ):
        hands.append(to_array(lms.landmark, w, h))
        labels.append(hd.classification[0].label)
    return pose, hands, labels


def make_clip(pose, hands: dict[str, np.ndarray]) -> dict:
    def r(a):
        return [[round(float(v), 5) for v in p] for p in a]

    return {
        "fps": 1,
        "frames": [
            {
                "pose": r(pose) if pose is not None else None,
                "left_hand": r(hands["left"]) if "left" in hands else None,
                "right_hand": r(hands["right"]) if "right" in hands else None,
            }
        ],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", type=Path, default=REPO / "data" / "letters")
    ap.add_argument(
        "--out-dir", type=Path, default=REPO / "backend" / "app" / "static" / "letters"
    )
    ap.add_argument("--langs", nargs="+", default=list(LANGS), choices=LANGS)
    args = ap.parse_args()

    import mediapipe as mp  # imported late so helpers are testable without it

    report: list[str] = []
    with (
        mp.solutions.hands.Hands(
            static_image_mode=True, max_num_hands=2
        ) as hands_model,
        mp.solutions.pose.Pose(static_image_mode=True) as pose_model,
    ):
        for lang in args.langs:
            (args.out_dir / lang).mkdir(parents=True, exist_ok=True)
            for letter in string.ascii_uppercase:
                path = args.data_dir / lang / f"{letter}.jpg"
                if not path.exists():
                    report.append(f"{lang} {letter}: image missing ({path})")
                    continue
                img = cv2.imread(str(path))
                if img is None:
                    report.append(f"{lang} {letter}: unreadable image")
                    continue
                pose, hand_list, labels = detect(img, hands_model, pose_model)
                sides = assign_sides(hand_list, labels, pose)
                norm = normalize(pose, sides)
                if norm is None:
                    report.append(
                        f"{lang} {letter}: no pose detected, skipped (cannot normalize)"
                    )
                    continue
                pose_n, hands_n = norm
                (args.out_dir / lang / f"{letter}.json").write_text(
                    json.dumps(make_clip(pose_n, hands_n))
                )
                missing = [s for s in EXPECTED_HANDS[lang] if s not in hands_n]
                if missing:
                    report.append(f"{lang} {letter}: missing {'+'.join(missing)} hand")

    print(
        "Missing-hand report"
        if report
        else "All letters extracted with expected hands."
    )
    for line in report:
        print(" ", line)


if __name__ == "__main__":
    main()
