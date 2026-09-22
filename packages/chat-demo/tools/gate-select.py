#!/usr/bin/env python3
"""Which UI test classes a change needs: the ones that declare they cover a
changed file.

Every test class in ios/uitests/Sources has a line above it,

    // covers: Composer.js screens/ChatScreen.js

naming the app files it exercises, relative to packages/chat-demo. A change
to one of those files selects the class; a change to a test file selects the
classes in it. A change to anything the map cannot place — the renderer, the
intrinsics, the test base class, the gate, a file no class claims — selects
everything, since nothing narrower would be honest.

Usage:
    tools/gate-select.py <ref>            files changed since <ref>, committed or not
    tools/gate-select.py --paths a b ...  as if these files had changed

Prints one class per line, or `all`, and the reasons on stderr.
"""

import glob
import os
import re
import subprocess
import sys

DEMO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_PREFIX = "packages/chat-demo/"
SOURCES = f"{DEMO}/ios/uitests/Sources"
# The gate skips these; they assert nothing and are run by GATE_RECORDERS=1
RECORDERS = {"SendDrive", "RevealShot", "TreeDump"}
# A change here can move any test
EVERYTHING = (
    "ios/uitests/Sources/DemoCase.swift",
    "ios/uitests/project.yml",
    "tools/gate.sh",
    "tools/gate-select.py",
)
# Nothing the iOS suite can see: generated, documentation, other platforms, unit tests
IGNORED = re.compile(
    r"^(ios/Podfile\.lock|ios/Pods/|android/|__tests__/|.*\.md$|ui-metrics\.md$|README\.md$)"
)


def coverage():
    """{class: {covered path, ...}} and {test file: {class, ...}}, from the covers lines."""
    covers, by_file = {}, {}
    for path in sorted(glob.glob(f"{SOURCES}/*.swift")):
        text = open(path).read()
        relative = os.path.relpath(path, DEMO)
        for m in re.finditer(
            r"^// covers: (.*)\n(?:final )?class (\w+): DemoCase", text, re.M
        ):
            covers[m.group(2)] = set(m.group(1).split())
            by_file.setdefault(relative, set()).add(m.group(2))
    return covers, by_file


def changed_since(ref):
    out = subprocess.run(
        ["git", "diff", "--name-only", ref, "--"],
        cwd=DEMO,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    untracked = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard", "--", "."],
        cwd=DEMO,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    root = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=DEMO,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    files = set(out.split())
    for f in untracked.split():
        files.add(os.path.relpath(os.path.join(DEMO, f), root))
    return sorted(files)


def select(paths, covers, by_file):
    chosen, reasons = set(), []
    for path in paths:
        if not path.startswith(REPO_PREFIX):
            return None, [f"{path}: outside the demo, so everything"]
        local = path[len(REPO_PREFIX) :]
        if IGNORED.match(local):
            reasons.append(f"{local}: nothing the suite can see")
            continue
        if local in EVERYTHING:
            return None, [f"{local}: every test depends on it, so everything"]
        if local in by_file:
            chosen |= by_file[local]
            reasons.append(f"{local}: its own classes {sorted(by_file[local])}")
            continue
        claimed = sorted(c for c, files in covers.items() if local in files)
        if not claimed:
            return None, [f"{local}: no class claims it, so everything"]
        chosen |= set(claimed)
        reasons.append(f"{local}: {claimed}")
    return sorted(chosen - RECORDERS), reasons


def main():
    covers, by_file = coverage()
    if len(sys.argv) >= 3 and sys.argv[1] == "--paths":
        paths = [
            p if p.startswith(REPO_PREFIX) else REPO_PREFIX + p for p in sys.argv[2:]
        ]
    elif len(sys.argv) == 2:
        paths = changed_since(sys.argv[1])
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    if not paths:
        print("nothing changed", file=sys.stderr)
        return
    chosen, reasons = select(paths, covers, by_file)
    for r in reasons:
        print(r, file=sys.stderr)
    if chosen is None:
        print("all")
    else:
        print("\n".join(chosen))


if __name__ == "__main__":
    main()
