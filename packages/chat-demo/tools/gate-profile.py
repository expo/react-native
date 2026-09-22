#!/usr/bin/env python3
"""Where the gate's time goes, read from the result bundles it leaves.

Usage: tools/gate-profile.py [bundle.xcresult ...]
       (defaults to the lanes' /tmp/chatdemo-gate-*.xcresult)

For every test, XCUITest records each step it took (a launch, a tap, a wait)
with a start time. A step's cost here is the gap to the next step's start, so a
sleep after a tap is charged to the tap. Prints the suite's seconds by kind of
step, the largest single gaps, and each test's split.
"""

import glob
import json
import re
import subprocess
import sys
from collections import Counter

CATEGORIES = [
    ("launch", r"^Set Up$"),
    ("teardown", r"^Tear Down$"),
    ("wait-exist", r"^Waiting .* to exist$"),
    ("wait-gone", r"^Waiting .* to not exist$"),
    ("wait-other", r"^Waiting "),
    ("tap", r"^Tap "),
    ("press", r"^(Press|Long press|Swipe|Drag|Pinch|Scroll)"),
    ("orientation", r"^Setting device orientation"),
    ("type", r"^Type "),
    ("find", r"^(Find |Checking existence|Get )"),
    ("screenshot", r"screenshot"),
]


def category(title):
    for name, pattern in CATEGORIES:
        if re.search(pattern, title, re.I):
            return name
    return "other"


def xcresult(*args):
    return json.loads(
        subprocess.run(
            ["xcrun", "xcresulttool", "get", "test-results", *args],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    )


def tests_in(bundle):
    found = []

    def walk(node):
        if node.get("nodeType") == "Test Case":
            found.append((node["nodeIdentifier"], parse_duration(node.get("duration"))))
        for child in node.get("children", []):
            walk(child)

    for node in xcresult("tests", "--path", bundle).get("testNodes", []):
        walk(node)
    return found


def parse_duration(text):
    """'2m 23s' -> 143.0"""
    total = 0.0
    for m in re.finditer(r"(\d+)\s*([ms])", text or ""):
        total += int(m.group(1)) * (60 if m.group(2) == "m" else 1)
    return total


def main():
    bundles = sys.argv[1:] or sorted(glob.glob("/tmp/chatdemo-gate-*.xcresult"))
    by_category = Counter()
    by_test = {}
    gaps = []
    for bundle in bundles:
        for ident, total in tests_in(bundle):
            for run in xcresult("activities", "--path", bundle, "--test-id", ident).get(
                "testRuns", []
            ):
                steps = run.get("activities", [])
                starts = [step.get("startTime") for step in steps]
                if not starts or starts[0] is None:
                    continue
                end = starts[0] + total
                categories = Counter()
                for i, step in enumerate(steps):
                    t0 = starts[i]
                    t1 = starts[i + 1] if i + 1 < len(starts) else end
                    if t0 is None or t1 is None:
                        continue
                    title = step.get("title", "")
                    categories[category(title)] += t1 - t0
                    gaps.append((t1 - t0, ident, title[:90]))
                by_category.update(categories)
                by_test[ident] = (total, categories)
    grand = sum(by_category.values())
    print("=== seconds by kind of step, whole suite")
    for name, seconds in by_category.most_common():
        print(f"{seconds:8.1f}  {100 * seconds / grand:5.1f}%  {name}")
    print(f"{grand:8.1f}  total")
    print("\n=== the 30 largest single gaps")
    for gap, ident, title in sorted(gaps, reverse=True)[:30]:
        cls, method = ident.split("/", 1)
        print(f"{gap:7.1f}  {cls:24} {method[:36]:36} {title}")
    print("\n=== per test")
    for ident, (total, c) in sorted(by_test.items(), key=lambda item: -item[1][0]):
        waits = c["wait-exist"] + c["wait-gone"] + c["wait-other"]
        gestures = c["tap"] + c["press"] + c["type"]
        print(
            f"{total:6.0f}  launch {c['launch']:5.1f}  waits {waits:6.1f}  gestures {gestures:6.1f}  "
            f"other {c['other'] + c['find'] + c['screenshot'] + c['orientation']:6.1f}  {ident}"
        )


if __name__ == "__main__":
    main()
