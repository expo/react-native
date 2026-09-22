#!/usr/bin/env python3
"""Diff this demo's composer against Messages', on the same simulator.

Messages ships with the iOS runtime and runs in the simulator, with two empty
conversations already in it. That makes it a pixel oracle at the SAME window
size as the demo — no cross-device scaling, no asking anyone for a screenshot,
and available whenever a number is in doubt.

    python3 tools/composer-diff.py                 # both apps, keyboard up
    python3 tools/composer-diff.py --docked        # both apps, keyboard down
    python3 tools/composer-diff.py --keep          # leave the screenshots

Every landmark is reported in POINTS on a 402-point window, which is what the
simulator this was written against reports. The scale is read from the
screenshot rather than assumed, so a different device is fine.

**Raise the keyboard before believing anything.** Messages' docked composer is a
different layout from its raised one — measured, its `+` glyph sits at x 40.33
docked and 28.33 raised, and it moves back and forth as the keyboard comes and
goes. Every published metric here is the raised one unless `--docked` says
otherwise.

What it cannot do: the conversations are empty and Messages will not accept
messages written into its database from outside — the schema's triggers call
functions only its own process registers, and rows inserted around them do not
surface. So this compares the COMPOSER, not the transcript.

One landmark to read loosely. `pill right` is found by walking in from the edge
until the surface stays above the bar, and Messages has a mic glyph inside its
field that breaks the run — so it reads a few points short there. Hand
measurement puts both at 389 to 390. Everything else agrees to a third of a
point or reports a difference that is real.
"""

import argparse
import re
import subprocess
import sys
import time
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("this needs Pillow: python3 -m pip install --user pillow")

DEMO = "dev.expo.frontierdemo"
MESSAGES = "com.apple.MobileSMS"
SHOTS = Path("/tmp/composer-diff")


def booted_device() -> str:
    out = subprocess.run(
        ["xcrun", "simctl", "list", "devices", "booted", "-j"],
        capture_output=True,
        text=True,
    ).stdout
    ids = re.findall(r'"udid"\s*:\s*"([0-9A-Fa-f-]+)"', out)
    if not ids:
        sys.exit("no booted simulator")
    return ids[0]


def sh(*args: str) -> None:
    subprocess.run(args, capture_output=True)


def tap(device: str, x: float, y: float) -> None:
    """A tap in POINTS. `idb` takes points, not pixels."""
    sh(str(Path.home() / ".local/bin/idb"), "ui", "tap", "--udid", device, str(x), str(y))


def shoot(device: str, name: str) -> Path:
    SHOTS.mkdir(parents=True, exist_ok=True)
    path = SHOTS / f"{name}.png"
    sh("xcrun", "simctl", "io", device, "screenshot", str(path))
    return path


def capture_messages(device: str, docked: bool) -> Path:
    sh("xcrun", "simctl", "terminate", device, DEMO)
    sh("xcrun", "simctl", "launch", device, MESSAGES)
    time.sleep(4)
    # The first conversation in the list. Empty, which is all this needs.
    tap(device, 200, 190)
    time.sleep(3)
    if not docked:
        tap(device, 200, 826)
        time.sleep(4)
    return shoot(device, "messages")


def capture_demo(device: str, docked: bool) -> Path:
    sh("xcrun", "simctl", "terminate", device, MESSAGES)
    sh("xcrun", "simctl", "launch", device, DEMO)
    time.sleep(8)
    tap(device, 200, 557)  # "Chat, with a composer"
    time.sleep(3)
    if not docked:
        tap(device, 230, 812)
        time.sleep(4)
    return shoot(device, "demo")


def run_end(profile, start: int, bar: float, scale: float) -> int:
    """How far the run beginning at `start` stays above the bar."""
    x = start
    while x < len(profile) - 1 and profile[x] > bar + 1.0:
        x += 1
    return x - start


def landmarks(path: Path) -> dict:
    """Where the composer's parts are, in points.

    Found by ink and by steps in one row rather than by any fixed offset: the
    two apps agree on the `+` glyph to a third of a point, so the glyph is the
    anchor everything else is measured from.
    """
    image = Image.open(path).convert("RGB")
    px = image.load()
    width, height = image.size
    scale = width / 402.0

    def value(x: float, y: float) -> float:
        return sum(px[int(x), int(y)]) / 3

    # Light or dark, decided by the page rather than asked for: the `+` is ink on
    # a light bar and light on a dark one, and every threshold below flips with
    # it. Sampled well above the composer, where the page is the page.
    dark = value(width - 8 * scale, height * 0.25) < 128

    # The `+` glyph: the strongest contrast in the leading quarter of the lower
    # half.
    ink = [
        (x, y)
        for y in range(height // 2, height)
        for x in range(0, int(100 * scale))
        if (value(x, y) > 150 if dark else value(x, y) < 120)
    ]
    if not ink:
        return {}
    top = min(y for _, y in ink)
    glyph = [(x, y) for x, y in ink if y < top + 70]
    gx = [x for x, _ in glyph]
    gy = [y for _, y in glyph]
    row = int((min(gy) + max(gy)) / 2)
    out = {
        "plus ink left": min(gx) / scale,
        "plus ink right": max(gx) / scale,
        "plus ink top": min(gy) / scale,
        "plus ink bottom": max(gy) / scale,
    }

    # Steps along the row through the glyph: the disc's edges, then the pill's.
    profile = [value(x, row) for x in range(width)]
    bar = sum(profile[width - 30 : width - 8]) / 22
    # A surface reads ABOVE the bar in light mode and above it in dark too — a
    # field is lighter than its bar either way — so the comparisons below do not
    # flip. What flips is only the ink.
    steps = [
        x
        for x in range(1, width)
        if abs(profile[x] - profile[x - 1]) >= 1.5
    ]
    merged = []
    for x in steps:
        if merged and x - merged[-1] < scale:
            continue
        merged.append(x)
    before = [x for x in merged if x < min(gx)]
    after = [x for x in merged if x > max(gx)]
    if before:
        out["disc left"] = before[-1] / scale
    if after:
        out["disc right"] = after[0] / scale

    def sustained(start: int, step: int) -> int:
        """The first x from `start` where the surface stays above the bar.

        A single step is not enough to find an edge here: both apps put a soft
        shadow around the disc and the field, so the row crosses the bar's level
        several times on the way. A run of ten points is the field.
        """
        run = int(10 * scale)
        x = start
        while 0 < x < width - run - 1:
            if all(profile[x + i] > bar + 1.0 for i in range(run)):
                return x
            x += step
        return -1

    left = sustained(int(after[0] + 4 * scale) if after else int(max(gx)), 1)
    if left > 0:
        out["pill left"] = left / scale
    right = sustained(width - int(11 * scale), -1)
    if right > 0:
        out["pill right"] = (right + run_end(profile, right, bar, scale)) / scale
    out["bar level"] = bar

    # The caret, which is the only strongly blue thing in the field.
    caret = [
        (x, y)
        for y in range(row - 60, row + 60)
        for x in range(int(78 * scale), int(95 * scale))
        if px[x, y][2] > px[x, y][0] + 40 and px[x, y][2] > 150
    ]
    if caret:
        out["caret left"] = min(x for x, _ in caret) / scale
        out["caret height"] = (
            max(y for _, y in caret) - min(y for _, y in caret) + 1
        ) / scale
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docked", action="store_true", help="keyboard down")
    parser.add_argument("--keep", action="store_true", help="keep the screenshots")
    args = parser.parse_args()

    device = booted_device()
    messages = landmarks(capture_messages(device, args.docked))
    demo = landmarks(capture_demo(device, args.docked))
    if not messages or not demo:
        sys.exit("could not find a composer in one of the screenshots; see " + str(SHOTS))

    print(f"{'landmark':<16}{'Messages':>10}{'ours':>10}{'diff':>9}")
    worst = 0.0
    for key, theirs in messages.items():
        if key not in demo:
            continue
        ours = demo[key]
        print(f"{key:<16}{theirs:>10.2f}{ours:>10.2f}{ours - theirs:>+9.2f}")
        worst = max(worst, abs(ours - theirs))
    print(f"\nlargest difference: {worst:.2f}")
    if not args.keep:
        for shot in SHOTS.glob("*.png"):
            shot.unlink()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
