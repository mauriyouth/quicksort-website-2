import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await page.goto('file:///Users/mohamedahmednah/Downloads/Edit%20Project.html');
await page.waitForTimeout(6000);
const regions = [
  ['header', { x: 60, y: 30, width: 1380, height: 400 }],
  ['general', { x: 60, y: 430, width: 1380, height: 340 }],
  ['schedule', { x: 60, y: 700, width: 960, height: 260 }],
  ['extensions', { x: 60, y: 930, width: 960, height: 420 }],
  ['pricing', { x: 60, y: 1360, width: 960, height: 430 }],
  ['notes', { x: 60, y: 1800, width: 960, height: 340 }],
];
for (const [name, clip] of regions) {
  await page.screenshot({ path: `/tmp/design-${name}.png`, clip });
}
await browser.close();
