import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engines = require(process.argv[2] || "playwright");
const browser = await engines[process.argv[4] || "chromium"].launch();
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.argv[3] || "http://localhost:3010", { waitUntil: "networkidle" });
  const menu = page.getByRole("listbox");
  const names = ["Source", "Category", "Validation", "Sample date (UTC)"];

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
      for (const name of names) {
        const trigger = page.getByRole("combobox", { name, exact: true });
        await trigger.click();
        await page.waitForFunction(() => document.querySelector('[role=combobox][aria-expanded=true]'));
        assert.equal(await menu.count(), 1);
        const style = await menu.evaluate((element) => {
          const css = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const checked = element.querySelector('[aria-selected=true]');
          return {
            padding: css.padding,
            radius: css.borderRadius,
            expectedRadius: parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.75,
            background: css.backgroundColor,
            checkColor: getComputedStyle(checked.querySelector('svg')).color,
            rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          };
        });
        assert.equal(style.padding, "6px");
        assert.ok(Math.abs(parseFloat(style.radius) - style.expectedRadius) < 0.01);
        assert.equal(style.background, theme === "dark" ? "rgb(21, 21, 23)" : "rgb(255, 255, 255)");
        assert.equal(style.checkColor, theme === "dark" ? "rgb(59, 115, 237)" : "rgb(37, 99, 235)");
        assert.ok(style.rect.left >= 7 && style.rect.right <= width - 7 && style.rect.top >= 7 && style.rect.bottom <= 993);
        const viewport = menu.locator('[data-slot="scroll-area-viewport"]');
        const scroll = await viewport.evaluate((element) => {
          const rows = Array.from(element.children).slice(0, 5);
          return {
            count: element.children.length,
            height: element.clientHeight,
            fiveRows: rows.at(-1).getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top,
            scrollbar: getComputedStyle(element).scrollbarWidth,
          };
        });
        assert.equal(scroll.scrollbar, "none");
        assert.ok(Math.abs(scroll.height - scroll.fiveRows) < 5);
        if (scroll.count > 5) {
          await page.waitForFunction(() => {
            const menu = document.querySelector('[role="listbox"]');
            return getComputedStyle(menu.querySelector('[data-slot=scroll-area-more]')).opacity === '1';
          });
          assert.ok((await viewport.evaluate((element) => getComputedStyle(element).maskImage)).includes("28px"));
          const more = menu.locator('[data-slot="scroll-area-more"]');
          const moreBox = await more.boundingBox();
          const viewportBox = await viewport.boundingBox();
          assert.ok(Math.abs(moreBox.width - moreBox.height) < 1);
          assert.ok(Math.abs(moreBox.x + moreBox.width / 2 - viewportBox.x - viewportBox.width / 2) < 1);
          assert.ok(viewportBox.y + viewportBox.height - moreBox.y - moreBox.height >= 3);
          assert.ok(viewportBox.y + viewportBox.height - moreBox.y - moreBox.height <= 5);
          await more.click();
          assert.ok(await viewport.evaluate((element) => element.scrollTop > 0));
          const scrolledMoreBox = await more.boundingBox();
          assert.ok(Math.abs(scrolledMoreBox.y - moreBox.y) < 1);
          assert.ok(await trigger.evaluate((element) => document.activeElement === element));
        } else {
          assert.equal(await viewport.evaluate((element) => getComputedStyle(element).maskImage), "none");
        }
        await page.keyboard.press("End");
        await page.waitForFunction(() => {
          const panel = document.querySelector('[role="listbox"]');
          const item = panel.querySelector('[data-highlighted]');
          const rect = item.getBoundingClientRect();
          const viewport = panel.querySelector('[data-slot=scroll-area-viewport]');
          const bounds = viewport.getBoundingClientRect();
          return item === viewport.lastElementChild && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
        });
        await page.waitForFunction(() => getComputedStyle(document.querySelector('[role="listbox"] [data-slot=scroll-area-more]')).opacity === '0');
        await page.keyboard.press("Home");
        await page.waitForFunction(() => {
          const panel = document.querySelector('[role="listbox"]');
          return panel.querySelector('[data-highlighted]') === panel.querySelector('[data-slot=scroll-area-viewport]').firstElementChild;
        });
        await page.keyboard.press("Escape");
        assert.equal(await menu.count(), 0);
        assert.ok(await trigger.evaluate((element) => document.activeElement === element));
      }
    }
  }

  const category = page.getByRole("combobox", { name: "Category", exact: true });
  await category.focus();
  await page.keyboard.type("news");
  await page.keyboard.press("Enter");
  assert.equal(await category.textContent(), "News");
  assert.equal(await menu.count(), 0);
  await category.click();
  await page.getByRole("option", { name: "All categories", exact: true }).click();
  assert.equal(await category.textContent(), "All categories");

  const source = page.getByRole("combobox", { name: "Source", exact: true });
  await source.click();
  await category.click();
  assert.equal(await menu.count(), 1);
  assert.equal(await menu.getAttribute("aria-label"), "Category");
  await page.keyboard.press("Tab");
  assert.equal(await menu.count(), 0);
  assert.ok(await category.evaluate((element) => document.activeElement !== element));
  await source.click();
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  assert.equal(await menu.count(), 0);

  const sample = page.getByRole("combobox", { name: "Sample date (UTC)", exact: true });
  await sample.click();
  const lastDate = (await page.getByRole("option").last().textContent()).slice(0, 10);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  assert.equal(await sample.textContent(), lastDate);
  await sample.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  assert.equal(await sample.textContent(), "Latest completed sample");

  await source.click();
  await page.getByRole("option", { name: /Wikipedia/ }).click();
  assert.ok(await sample.isDisabled());
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  assert.ok(await sample.isEnabled());
  assert.deepEqual(errors, []);
  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  await touch.goto(process.argv[3] || "http://localhost:3010", { waitUntil: "networkidle" });
  await touch.getByRole("combobox", { name: "Category", exact: true }).tap();
  await touch.getByRole("option", { name: "News", exact: true }).tap();
  assert.equal(await touch.getByRole("combobox", { name: "Category", exact: true }).textContent(), "News");
  await touch.getByRole("combobox", { name: "Sample date (UTC)", exact: true }).tap();
  await touch.locator('[role="listbox"] [data-slot="scroll-area-more"]').tap();
  assert.ok(await touch.locator('[role="listbox"] [data-slot="scroll-area-viewport"]').evaluate((element) => element.scrollTop > 0));
  await touch.close();
  console.log("PASS: supplied menu styling, five visible options, hidden scrollbars, edge fades, scroll chevron, desktop/mobile, light/dark, touch, keyboard, typeahead, selection, dismissal, focus, disabled state, and reset.");
} finally {
  await browser.close();
}
