import json,pathlib,os,time
from playwright.sync_api import sync_playwright
import tempfile,shutil
r=pathlib.Path(__file__).resolve().parents[1];tmp=tempfile.TemporaryDirectory();base=pathlib.Path(os.getenv('REELFORGE_TEST_OUTPUT',tmp.name));started=time.monotonic()
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
 p=b.new_page(accept_downloads=True)
 p.on('pageerror',lambda e: print('Page error',e,flush=True))
 p.goto(os.getenv('REELFORGE_TEST_URL','http://127.0.0.1:8385'))
 def done():
  p.locator('#cancel').wait_for(state='hidden',timeout=180000)
  print(round(time.monotonic()-started,1),p.locator('#status').text_content(),flush=True)
 def down(id,name):
  with p.expect_download() as d:p.locator('#'+id).click()
  d.value.save_as(str(base/name))
 p.set_input_files('#reference',str(r/'assets/studio/alpine-field-notes.mp4'));done()
 p.locator('#style-editor summary').click();down('evidence','audio-direction-reference.json')
 ref=json.loads((base/'audio-direction-reference.json').read_text())
 print('reference',ref['style']['profile']['references'][0]['soundProfile'],flush=True)
 assert ref['style']['profile']['references'][0]['soundProfile']['speechShare']>.5
 p.select_option('#format','cinematic')
 p.locator('#options summary').click();p.select_option('#quality','draft');p.select_option('#iterations','0')
 p.set_input_files('#file',str(r/'examples/audio-direction/footage-with-music.mp4'));done()
 print(p.locator('#notes').text_content(),flush=True)
 p.locator('#timeline-tools summary').click();down('cut-json','audio-direction-cut.json');down('save','audio-direction-result.mp4')
 meta=json.loads((base/'audio-direction-cut.json').read_text())['metadata']
 assert meta['sourceSound'][0]['summary']['musicShare']>.65 and 'music' not in meta['effects']['audio']
 print('Original music present, second bed omitted',flush=True)
 p.locator('#feedback-panel summary').click();p.select_option('#feedback-choice','keep-mix');p.locator('#remember-feedback').click()
 p.wait_for_function('document.querySelector("#status").textContent.startsWith("Saved.")')
 p.reload()
 p.locator('#examples-panel summary').click()
 for which in ['edit','0']:
  p.select_option('#example-source',which);p.locator('#watch-example').click()
  p.wait_for_function('document.querySelector("#example-video").readyState>=2')
  assert p.locator('#example-video').evaluate('v=>v.duration')>5
 p.locator('#remake').click();done()
 p.locator('#timeline-tools summary').click()
 down('cut-json','audio-direction-recalled.json')
 applied=json.loads((base/'audio-direction-recalled.json').read_text())['metadata']['memory']['applied']
 assert any(a['choice']=='keep-mix' for a in applied)
 print("Original and approved MP4 replayed after reload; sound preference retrieved.",flush=True)
