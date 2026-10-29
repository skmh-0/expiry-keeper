/** 截一下应用顶部，确认左上角标志换成了新图标。 */
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 300 }, locale: 'zh-CN' })).newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.locator('.app-header').screenshot({ path: 'shots/header-logo.png' });
await browser.close();
