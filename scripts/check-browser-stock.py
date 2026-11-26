import pathlib, json, os, tempfile, shutil
from playwright.sync_api import sync_playwright
base=pathlib.Path(__file__).resolve().parents[1]/'examples/asset-library'
temp=tempfile.TemporaryDirectory()
output=pathlib.Path(os.getenv('REELFORGE_TEST_OUTPUT',temp.name))
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
 p=b.new_page(accept_downloads=True)
 p.goto(os.getenv('REELFORGE_TEST_URL','http://127.0.0.1:8385'));p.locator('#options summary').click()
 p.select_option('#quality','draft');p.select_option('#iterations','0');p.select_option('#ratio','horizontal')
 for k in ['motion','sound','captions']:p.uncheck('#'+k)
 p.set_input_files('#file',str(base/'narration.mp4'));p.locator('#cancel').wait_for(state='hidden',timeout=240000)
 p.set_input_files('#srt',str(base/'narration.srt'));p.wait_for_function('!document.querySelector("#cancel").hidden')
 p.locator('#cancel').wait_for(state='hidden',timeout=150000)
 print(p.locator('#status').inner_text(),p.locator('#notes').inner_text(),flush=True)
 p.locator('#timeline-tools summary').click()
 for ctrl,name in [('cut-json','solar-cut.json'),('save','solar-cut.mp4')]:
  with p.expect_download() as d:p.locator('#'+ctrl).click()
  d.value.save_as(str(output/name))
 metadata=json.loads((output/'solar-cut.json').read_text())['metadata']
 m=metadata['broll']
 report=metadata['quality'][-1]['report']
 assert all(check['status']=='pass' for check in report['checks'] if check['id'] in ('caption-presence','caption-contrast'))
 assert m['assetId']=='video-solar-flare' and m['sourceURL'].startswith('https://images.nasa.gov/');print(m,flush=True)
