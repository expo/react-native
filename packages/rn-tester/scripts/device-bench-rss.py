#!/usr/bin/env python3
"""Collects the shared text benchmark's results, and samples the app's memory.

    python3 device-bench-rss.py [out.json]

Two things arrive on :8347. Speed results come as one JSON body and are printed
and saved. Memory announcements come one per mount and unmount; for each, this
reads the resident set of the running RNTester process and records it, so a
tier's retained memory is the difference between its mounted and unmounted
samples.

Measuring memory this way rather than by multiplying struct sizes by a model of
which nodes a tier creates is deliberate: the model is the part that would have
to be argued rather than measured, and it is exactly where the two trees differ.

The process is found by name, so only one RNTester may be running — which is
also true of the speed benchmark, since both builds share the same simulator.

For the Android emulator: `adb reverse tcp:8347 tcp:8347` first. RSS sampling
is host-side and iOS-simulator only; on Android the memory pass records the
announcements without a figure.
"""

import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

OUT = sys.argv[1] if len(sys.argv) > 1 else None

samples = []
speed = None


def rss_kb():
    """Resident set of the simulator's RNTester process, in KiB."""
    try:
        pids = subprocess.check_output(
            ['pgrep', '-f', 'RNTester.app/RNTester'], text=True
        ).split()
    except subprocess.CalledProcessError:
        return None
    if not pids:
        return None
    # The newest process: an older one may be a terminated build still winding
    # down, and charging its memory to this run would be silent nonsense.
    best = None
    for pid in pids:
        try:
            value = subprocess.check_output(
                ['ps', '-o', 'rss=', '-p', pid], text=True
            ).strip()
        except subprocess.CalledProcessError:
            continue
        if value:
            best = max(best or 0, int(value))
    return best


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        global speed
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.send_response(200)
        self.end_headers()
        data = json.loads(body)
        if data.get('suite') == 'shared-text-memory':
            data['rssKb'] = rss_kb()
            samples.append(data)
            print(
                f"  {data['phase']:<9} pass {data['pass']}  {data['tier']:<32}"
                f"  {data['rssKb']} KiB",
                flush=True,
            )
        else:
            speed = data
            print(json.dumps(data, indent=1), flush=True)
        write_out()

    def log_message(self, *args):
        pass


def write_out():
    if OUT:
        with open(OUT, 'w') as f:
            json.dump({'speed': speed, 'memory': samples}, f, indent=1)


print('listening on :8347 — ctrl-c to stop')
try:
    HTTPServer(('0.0.0.0', 8347), Handler).serve_forever()
except KeyboardInterrupt:
    write_out()
    print('\nstopped')
