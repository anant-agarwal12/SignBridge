# Clip format

A **clip** is a JSON file describing a sequence of body/hand landmarks. Every later phase
(fingerspelling, lexicon signs, generated motion) produces and consumes this format.

```json
{
  "fps": 30,
  "frames": [
    {
      "pose":       [[x, y, z], ... 33 entries ...],
      "left_hand":  [[x, y, z], ... 21 entries ...],
      "right_hand": null
    }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `fps` | number > 0 | Playback rate. One-frame clips (static letters) use `1`; the value is ignored for a single frame. |
| `frames` | array, length >= 1 | |
| `frames[].pose` | 33 x `[x,y,z]` or `null` | MediaPipe Pose landmark order. |
| `frames[].left_hand` | 21 x `[x,y,z]` or `null` | MediaPipe Hands landmark order. |
| `frames[].right_hand` | 21 x `[x,y,z]` or `null` | MediaPipe Hands landmark order. |

`null` means "not detected / not present". Consumers must treat a `null` hand as "leave that hand
at its idle pose".

## Left and right

`left_hand` / `pose` indices 11, 13, 15 are the signer's **anatomical left** side (not the left of
the image). Producers working from un-mirrored images must account for MediaPipe's handedness
label, which assumes a mirrored (selfie) image.

## Coordinate space

All three arrays share one space, normalized per frame:

- **Origin:** the midpoint of the shoulders (Pose landmarks 11 and 12).
- **Unit:** the shoulder width, i.e. the 3D distance between landmarks 11 and 12.
- **Axes** (same convention as MediaPipe image space, signer facing the camera):
  `+x` toward the image right, `+y` **down**, `+z` away from the camera
  (smaller `z` = closer to the camera). The signer's forward direction is therefore `-z`.

Hand `z` values are given relative to the pose wrist depth, so hand and pose agree.

Consumers convert to their own convention. The VRM retargeter (`frontend/src/avatar/retarget.ts`)
maps `(x, y, z) -> (x, -y, -z)` (y up, avatar faces `+z`).

## Landmark indices used

- Pose: 11/12 shoulders, 13/14 elbows, 15/16 wrists (left/right).
- Hand: 0 wrist; 1-4 thumb; 5-8 index; 9-12 middle; 13-16 ring; 17-20 pinky
  (each finger: MCP, PIP, DIP, TIP; thumb: CMC, MCP, IP, TIP).

## Static letter clips

`backend/app/static/letters/{asl,isl}/<LETTER>.json` are one-frame clips served at
`/static/letters/{lang}/<LETTER>.json`.

## Fingerspell API

`POST /fingerspell` returns `letters: [{char, clip_url, pause}]`. A word boundary is
`{"char": " ", "clip_url": null, "pause": true}`; players hold the neutral pose (~300 ms) for it.
