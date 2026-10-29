/** 验证一次拍多张：托盘计数、移除、识别入口、直接手填入口。 */
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const inputs = page.locator('input[type=file]');
await inputs.nth(1).setInputFiles('shots/label-1400.jpg');
await page.waitForTimeout(900);
await inputs.nth(1).setInputFiles('shots/label-1400.jpg');
await page.waitForTimeout(900);

console.log('托盘张数：', await page.locator('.tray-item').count());
console.log('提示文案：', (await page.locator('.card .block-label').allInnerTexts()).find((t) => t.includes('已拍')) ?? '(无)');
console.log('主按钮：', (await page.getByRole('button', { name: /识别这 \d+ 张/ }).innerText()).replace(/\s+/g, ' '));
await page.screenshot({ path: 'shots/multi-01-tray.png', fullPage: false });

// 移除一张
await page.locator('.tray-remove').first().click();
await page.waitForTimeout(400);
console.log('移除后张数：', await page.locator('.tray-item').count());

// 识别入口（没配 Key 时应落到手工录入，不该崩）
await page.getByRole('button', { name: /识别这 \d+ 张/ }).click();
await page.waitForSelector('.sheet', { timeout: 20000 });
await page.waitForTimeout(500);
console.log('确认页提示：', (await page.locator('.sheet .notice').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | '));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
console.log('识别后托盘张数（应为 0）：', await page.locator('.tray-item').count());

// 直接手填入口
await inputs.nth(1).setInputFiles('shots/label-1400.jpg');
await page.waitForTimeout(900);
await page.getByRole('button', { name: '不识别，直接手填' }).click();
await page.waitForSelector('.sheet', { timeout: 20000 });
await page.waitForTimeout(500);
console.log('手填入口来源：', (await page.locator('.sheet-head p').first().innerText()).replace(/\s+/g, ' '));
await page.screenshot({ path: 'shots/multi-02-manual.png', fullPage: false });

await browser.close();
