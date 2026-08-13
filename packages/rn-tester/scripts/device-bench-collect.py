#!/usr/bin/env python3
"""Collects DeviceTextBenchmark results POSTed by RNTester release builds.

Usage: python3 device-bench-collect.py [out.json]
Listens on :8347 until one result arrives, writes it to stdout/out.json.
For the Android emulator run `adb reverse tcp:8347 tcp:8347` first.
"""
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

out = sys.argv[1] if len(sys.argv) > 1 else None

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.send_response(200); self.end_headers()
        data = json.loads(body)
        text = json.dumps(data, indent=1)
        print(text, flush=True)
        if out:
            open(out, 'w').write(text)
        raise KeyboardInterrupt

    def log_message(self, *args):
        pass

try:
    HTTPServer(('0.0.0.0', 8347), Handler).serve_forever()
except KeyboardInterrupt:
    pass
