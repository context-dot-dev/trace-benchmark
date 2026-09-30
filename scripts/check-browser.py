"""Verify the independent browser runtime under the deployment's service account."""
import asyncio,json
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(channel='chromium',headless=True)
  page=await b.new_page()
  await page.set_content('<main><h1>Reference browser ready</h1></main>')
  print(json.dumps({'browser':b.version,'rendered':await page.locator('h1').inner_text()}))
  await b.close()
asyncio.run(main())
