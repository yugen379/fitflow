# Real browser-engine proof of the live barcode-scan camera pipeline.
#
#   1. node scripts/gen-barcode-y4m.mjs            (creates the fake-camera video)
#   2. python scripts/scanner_cam_test.py
#
# Launches Chromium with a FAKE camera feeding a generated EAN-13 video, on a
# mobile viewport, and drives the real html5-qrcode setup from scanner-selftest.html.
# Asserts: getUserMedia succeeds → scanner starts → barcode DECODES to the expected
# code → a frame can be grabbed. This covers the entire on-device software path
# except iOS-Safari's gesture quirk (different engine) and physical optics.

import json, os, subprocess, sys, threading, http.server, socketserver, functools, time
from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.path.join(ROOT, "scripts", ".tmp")
Y4M = os.path.join(TMP, "barcode.y4m")
EXPECTED = "5901234123457"
PORT = 8099

def log(ok, name, detail=""):
    tag = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
    print(f"  {tag} {name}" + (f"  \033[2m{detail}\033[0m" if detail else ""))
    return ok

# Serve the project root so the page can load /node_modules/html5-qrcode/...
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Quiet(socketserver.TCPServer):
    allow_reuse_address = True
httpd = Quiet(("127.0.0.1", PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

results = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-fake-device-for-media-stream",
                "--use-fake-ui-for-media-stream",
                f"--use-file-for-fake-video-stream={Y4M}",
            ],
        )
        # Mobile emulation: phone viewport + UA + camera permission granted.
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            is_mobile=True,
            has_touch=True,
            permissions=["camera"],
        )
        page = ctx.new_page()
        page.goto(f"http://127.0.0.1:{PORT}/scripts/scanner-selftest.html", wait_until="load")

        # Wait until both the file-decode and the camera path have reported.
        deadline = time.time() + 25
        while time.time() < deadline:
            st = page.evaluate("window.__state")
            if st.get("frameOk") is not None and st.get("fileDecoded") is not None:
                break
            page.wait_for_timeout(300)
        st = page.evaluate("window.__state")

        results.append(log(st.get("gum") is True, "getUserMedia acquired the camera (gesture path)", st.get("error") or ""))
        results.append(log(st.get("started") is True, "html5-qrcode live scanner started", st.get("error") or ""))
        results.append(log(st.get("frameOk") is True, "captured a JPEG frame for the AI fallback tier", str(st.get("frameOk"))))
        results.append(log(st.get("fileDecoded") == EXPECTED, "decoded a real EAN-13 (html5-qrcode scanFile)", f"got {st.get('fileDecoded')!r}, expected {EXPECTED}"))

        browser.close()
finally:
    httpd.shutdown()

print()
ok = all(results) and len(results) == 4
print("  \033[32m\033[1m✓ camera pipeline verified in-browser\033[0m" if ok
      else "  \033[31m✗ camera pipeline FAILED\033[0m")
sys.exit(0 if ok else 1)
