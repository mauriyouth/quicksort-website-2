import { chromium } from '@playwright/test';
const BASE = 'http://localhost:5174';
const routes = ['/', '/career', '/blog', '/ai-for-business', '/data-for-ai', '/infrastructure-for-ai', '/voice-ai'];
const widths = [1440, 1280, 768, 390];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const w of widths) {
  await page.setViewportSize({ width: w, height: 900 });
  for (const r of routes) {
    await page.goto(BASE + r, { waitUntil: 'networkidle' }).catch(()=>{});
    await page.addStyleTag({ content: '*{overflow-x:visible !important}' });
    await page.waitForTimeout(250);
    const res = await page.evaluate(() => {
      const docW = document.documentElement.clientWidth;
      const scrollW = document.documentElement.scrollWidth;
      const desc = (el) => {
        const p = [];
        let n = el;
        while (n && n !== document.body && p.length < 3) { p.unshift(`${n.tagName.toLowerCase()}.${(((n.className&&n.className.baseVal!==undefined)?n.className.baseVal:n.className)||'').toString().trim().split(/\s+/).slice(0,6).join('.')}`); n = n.parentElement; }
        return p.join(' > ');
      };
      const off = [];
      for (const el of document.querySelectorAll('*')) {
        const rect = el.getBoundingClientRect();
        if (rect.height === 0 && rect.width === 0) continue;
        if (rect.right > docW + 1 || rect.left < -1) {
          if (el.children.length === 0 || ![...el.children].some(c => { const cr = c.getBoundingClientRect(); return cr.right > docW + 1 || cr.left < -1; })) {
            off.push({ d: desc(el), l: Math.round(rect.left), rr: Math.round(rect.right), w: Math.round(rect.width) });
          }
        }
      }
      return { docW, scrollW, off: off.slice(0, 6) };
    });
    if (res.scrollW <= res.docW + 1) { console.log(`[${w}] ${r}  OK`); continue; }
    console.log(`\n[${w}] ${r}  UNCLIPPED OVERFLOW = ${res.scrollW - res.docW}px`);
    for (const o of res.off) console.log(`   L=${o.l} R=${o.rr} W=${o.w}  ${o.d}`);
  }
}
await browser.close();
