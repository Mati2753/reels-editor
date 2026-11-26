"""Render an ordinary-background portrait through the browser's normal upload controls."""
import json
import os
from pathlib import Path
import shutil
import tempfile
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as scratch, sync_playwright() as pw:
    out = Path(os.getenv("REELFORGE_TEST_OUTPUT", scratch))
    browser = pw.chromium.launch(executable_path=shutil.which("chromium"), args=["--no-sandbox"])
    page = browser.new_page(accept_downloads=True)
    page.on("pageerror", lambda msg: print("Page error", msg, flush=True))
    page.on("console", lambda msg: print(msg.text[:400], flush=True) if msg.type=="error" else None)
    page.goto(os.getenv("REELFORGE_TEST_URL", "http://127.0.0.1:8384"))
    page.locator("#options summary").click()
    for option in ["motion","sound","broll","captions"]:
        page.uncheck("#"+option)
    page.select_option("#ratio","square")
    page.select_option("#quality","draft")
    page.select_option("#iterations","0")
    page.check("#portrait")
    page.set_input_files("#file",str(root/"examples/portrait-matte/source.mp4"))
    page.locator("#cancel").wait_for(state="hidden",timeout=240000)
    print(page.locator("#status").text_content(),page.locator("#notes").text_content(),flush=True)
    page.locator("#timeline-tools summary").click(timeout=4000)
    for control,name in [("#cut-json","portrait-timeline.json"),("#save","portrait-export.mp4"),("#mask-download","portrait-mask.mp4")]:
        with page.expect_download() as download: page.locator(control).click()
        download.value.save_as(str(out/name))
    report=json.loads((out/"portrait-timeline.json").read_text())["metadata"]["portraitMattes"]
    assert report and all(scene["accepted"] for scene in report), report
    print("Accepted scenes",len(report),"sampled masks",sum(len(scene["observations"]) for scene in report),flush=True)
    browser.close()
