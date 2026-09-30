"""Exercise the running article end to end and save screenshots plus assertions."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
 out=Path('artifacts/release-verification');out.mkdir(parents=True,exist_ok=True)
 checks=[];errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(channel='chromium')
  context=await browser.new_context(permissions=['clipboard-read','clipboard-write'])
  page=await context.new_page()
  page.on('pageerror',lambda error:errors.append(str(error)))
  await page.goto(os.environ.get('TRACE_UI_URL','http://127.0.0.1:8794/'),wait_until='networkidle')
  await page.get_by_role('grid',name='Provider content results').wait_for()
  async def check(label,condition):
   checks.append({'check':label,'passed':bool(condition)})
   if not condition:raise AssertionError(label)
  await check('Real provider rows',await page.get_by_role('grid',name='Provider content results').locator('tbody tr').count()==4)
  await check('No illustrative rankings',await page.get_by_text('Illustrative data',exact=False).count()==0)
  for width in [320,390,768,1280]:
   await page.set_viewport_size({'width':width,'height':900})
   await check(f'No page overflow at {width}',await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
   await check(f'Tables fit at {width}',await page.locator('table').evaluate_all('(tables)=>tables.every(t=>t.getBoundingClientRect().width<=window.innerWidth)'))
   await check(f'Logos load at {width}',await page.locator('.provider-logo').evaluate_all('(imgs)=>imgs.every(i=>i.complete&&i.naturalWidth>0)'))
   if width in [390,1280]:
    await page.screenshot(path=str(out/f'after-{width}-viewport.png'))
    await page.screenshot(path=str(out/f'after-{width}.png'),full_page=True)
  await page.get_by_role('button',name='Search-discovered pages',exact=True).click()
  await check('Search cohort switches',await page.locator('.dataset-description').inner_text()=='URLs found by Context Search using NEEDLE queries. This selection may favor Context, so these results are kept separate.')
  await page.get_by_role('button',name='Independent pages',exact=True).click()
  await page.get_by_role('button',name='Table',exact=True).first.click()
  await check('Comparison table appears',await page.get_by_role('grid',name='Scraping comparison',exact=True).count()==1)
  await page.get_by_role('button',name='Charts',exact=True).first.click()
  await page.get_by_label('Find a page',exact=True).fill('impossible-no-matches-390481')
  await check('Empty filter state',await page.get_by_text('No matching results',exact=True).is_visible())
  await page.get_by_role('button',name='Clear filters',exact=True).click()
  await page.get_by_role('button',name='Inspect Context result',exact=False).first.click()
  await check('Evidence dialog opens',await page.get_by_role('dialog').is_visible())
  await page.wait_for_function('document.querySelector("[role=dialog]")?.contains(document.activeElement)')
  await page.keyboard.press('Escape')
  await page.get_by_role('dialog').wait_for(state='hidden')
  await check('Dialog closes',await page.get_by_role('dialog').count()==0)
  await page.get_by_role('button',name='Dark appearance',exact=True).click()
  await check('Dark theme',await page.locator('html').evaluate('(e)=>e.classList.contains("dark")'))
  await page.screenshot(path=str(out/'after-dark.png'),full_page=True)
  await page.get_by_role('button',name='Light appearance',exact=True).click()
  await page.get_by_role('button',name='Copy NEEDLE citation',exact=True).click()
  await check('Citation copied','@misc{needle2026' in await page.evaluate('navigator.clipboard.readText()'))
  await check('No runtime errors',not errors)
  await browser.close()
 report={'passed':all(c['passed'] for c in checks),'checks':checks,'runtime_errors':errors}
 (out/'ui.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'passed':report['passed'],'checks':len(checks),'artifact':str(out/'ui.json')}))
asyncio.run(main())
