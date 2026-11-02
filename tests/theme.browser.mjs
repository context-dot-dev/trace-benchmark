import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || "playwright");
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(process.argv[3] || "http://localhost:3010", {
    waitUntil: "networkidle",
  });
  for (const [width, theme] of [[1440, "dark"], [390, "light"], [1440, "dark"], [390, "light"]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "Dark appearance" }).filter({ visible: true }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    assert.ok((await page.getByRole("button", { name: "Dark appearance", includeHidden: true }).evaluateAll(
      buttons => buttons.map(button => button.getAttribute("aria-pressed")),
    )).every(value => value === String(theme === "dark")));
  }
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  console.log("PASS: desktop and mobile theme controls stay synchronized and the selected theme persists.");
} finally {
  await browser.close();
}
