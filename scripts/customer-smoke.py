import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
errors = []
warnings = []

def on_console(msg):
    if msg.type == "error":
        errors.append(f"[console.error] {msg.text}")
    elif msg.type == "warning":
        warnings.append(f"[console.warn] {msg.text}")

def on_pageerror(exc):
    errors.append(f"[pageerror] {exc}")

def on_requestfailed(req):
    # ignore benign aborts
    f = req.failure or ""
    if "net::ERR_ABORTED" not in str(f):
        errors.append(f"[requestfailed] {req.method} {req.url} -> {f}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 412, "height": 915})  # phone-ish
    page.on("console", on_console)
    page.on("pageerror", on_pageerror)
    page.on("requestfailed", on_requestfailed)

    print(f"==> goto {URL}")
    page.goto(URL, wait_until="domcontentloaded", timeout=45000)
    # Vite's HMR websocket means networkidle never fires; wait on the app root instead.
    try:
        page.wait_for_selector("#root *", timeout=30000)
    except Exception:
        pass
    page.wait_for_timeout(4000)  # let React + lazy chunks settle

    title = page.title()
    print(f"title: {title!r}")
    print(f"final url: {page.url}")

    page.screenshot(path="/tmp/ff-landing.png", full_page=True)

    # Inventory interactive elements the customer would see
    btns = page.locator("button").all()
    links = page.locator("a").all()
    inputs = page.locator("input").all()
    print(f"buttons={len(btns)} links={len(links)} inputs={len(inputs)}")

    visible_btn_text = []
    for b in btns[:25]:
        try:
            if b.is_visible():
                t = (b.inner_text() or b.get_attribute("aria-label") or "").strip().replace("\n", " ")
                if t:
                    visible_btn_text.append(t[:40])
        except Exception:
            pass
    print("visible buttons:", visible_btn_text)

    # Is this the login screen or the app?
    body = page.inner_text("body")[:600]
    print("---- body text (first 600) ----")
    print(body)
    print("--------------------------------")

    print(f"\nERRORS ({len(errors)}):")
    for e in errors:
        print("  " + e)
    print(f"WARNINGS ({len(warnings)}):")
    for w in warnings[:15]:
        print("  " + w)

    browser.close()

print("\nRESULT:", "FAIL" if errors else "PASS (no console/page errors)")
sys.exit(1 if errors else 0)
