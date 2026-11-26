from pathlib import Path
from playwright.sync_api import sync_playwright
import time,json,os,tempfile,shutil
root=Path(__file__).resolve().parents[1]
temporary=tempfile.TemporaryDirectory()
work=Path(temporary.name)
evidence=root/'examples/verified-browser'
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
 page=browser.new_page(accept_downloads=True)
 page.on('pageerror',lambda e: print('Browser error',e,flush=True))
 page.goto(os.environ.get('REELFORGE_TEST_URL','http://127.0.0.1:8382'))
 started=time.monotonic()
 def done():
  page.locator('#cancel').wait_for(state='hidden',timeout=200000)
  print(round(time.monotonic()-started,1),page.locator('#status').text_content(),flush=True)
 def save(selector,path):
  with page.expect_download() as d: page.locator(selector).click()
  d.value.save_as(str(path))
 page.set_input_files('#reference',str(evidence/'ocr-cards.mp4'))
 done()
 page.locator('#style-editor summary').click()
 save('#evidence',work/'ocr-evidence-new.json')
 result=json.loads((work/'ocr-evidence-new.json').read_text())
 layout=result['style']['profile']['references'][0]['captionLayout']
 assert layout['samples'] >= 2 and layout['uppercase'] and layout['ink']
 assert len(result['evidence'][0]['visibleText'])>0
 page.locator('#options summary').click()
 page.select_option('#quality','draft')
 page.locator('#remake').click();done()
 page.locator('#feedback-panel summary').click()
 page.select_option('#feedback-choice','still-camera')
 page.locator('#remember-feedback').click()
 page.wait_for_function('document.querySelector("#status").textContent.startsWith("Saved.")')
 page.reload()
 page.locator('#remake').click();done()
 page.locator('#timeline-tools summary').click()
 save('#cut-json',work/'ocr-memory-timeline.json')
 meta=json.loads((work/'ocr-memory-timeline.json').read_text())['metadata']
 assert meta['memory']['applied'][0]['choice']=='still-camera'
 assert all(s['framing']['scale']==1 and 'move' not in s['framing'] for s in meta['effects']['segments'])
 save('#save',work/'ocr-memory-cut.mp4')
 print('Measured caption presence:',next(c for c in meta['quality'][-1]['report']['checks'] if c['id']=='caption-presence'),flush=True)
 page.locator('#options summary').click()
 for key in ['motion','broll','sound']: page.uncheck('#'+key)
 page.check('#screen');page.select_option('#quality','draft')
 page.set_input_files('#file',str(root/'examples/director-feedback/screen-source.mp4'))
 done()
 save('#cut-json',work/'screen-cut.json')
 screen=json.loads((work/'screen-cut.json').read_text())['metadata']['screens'][0]
 assert screen['centers'][-1]['x']-screen['centers'][0]['x']>.35
 print("Validated OCR learning, recall after reload, export and screen tracking.",flush=True)
 page.uncheck('#screen')
 page.set_input_files('#file',str(root/'examples/face-framing/source.mp4'))
 done()
 save('#cut-json',work/'face-cut.json')
 centers=json.loads((work/'face-cut.json').read_text())['metadata']['faces'][0]['centers']
 assert centers[-1]['x']-centers[0]['x']>.35
 print("Validated moving face detection and vertical export.",flush=True)
 browser.close()
