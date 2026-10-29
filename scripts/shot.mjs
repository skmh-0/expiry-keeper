/** 用本机 Edge 跑一遍主要流程并截图，用于界面验收。 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const outDir = process.env.OUT ?? 'shots';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'msedge',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

const problems = [];

async function shoot(page, name, fullPage = false) {
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage });
  console.log(`shot ${name}`);
}

async function collect(page, tag) {
  page.on('pageerror', (error) => problems.push(`${tag} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${tag} console: ${message.text()}`);
  });
}

const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
});
const page = await mobile.newPage();
await collect(page, 'mobile');
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await shoot(page, '01-scan');

// 空状态（猫脸）截图
await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(400);
await shoot(page, '01b-empty-pantry');
await page.getByRole('button', { name: '扫码', exact: true }).click();
await page.waitForTimeout(300);

// 未配置识别引擎时：手动输入条码 → 手工补全 → 入库
await page.getByPlaceholder('13 位商品条码').fill('6901234567892');
await page.getByRole('button', { name: '查询' }).click();
await page.waitForSelector('.sheet', { timeout: 15000 });
await page.waitForTimeout(500);
await shoot(page, '02-review-top');
await page.locator('.sheet-body').evaluate((node) => {
  node.scrollTop = node.scrollHeight * 0.42;
});
await page.waitForTimeout(250);
await shoot(page, '03-review-mid');
await page.locator('.sheet-body').evaluate((node) => {
  node.scrollTop = node.scrollHeight;
});
await page.waitForTimeout(250);
await shoot(page, '04-review-bottom');

await page.locator('label.field', { hasText: '商品名称' }).locator('input').fill('测试商品 500g');
await page.locator('label.field', { hasText: '生产厂家' }).locator('input').fill('示例食品有限公司');
await page.locator('label.field', { hasText: '配料表原文' }).locator('textarea').fill('水、小麦粉、食用盐、食品添加剂（山梨酸钾）');
await page.locator('label.field', { hasText: '重量' }).locator('input').first().fill('500');
await page.locator('label.field', { hasText: '存放位置' }).locator('input').fill('厨房吊柜');
await page.waitForTimeout(300);
await shoot(page, '05-review-filled');

await page.getByRole('button', { name: '确认入库' }).click();
await page.waitForTimeout(900);
await shoot(page, '06-pantry');

await page.locator('.list-item').first().click();
await page.waitForSelector('.sheet', { timeout: 10000 });
await page.waitForTimeout(400);
await shoot(page, '07-item');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// 商品档案库已挪进设置
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.waitForTimeout(400);
await shoot(page, '10-settings', true);
await page.getByRole('button', { name: '打开商品档案库' }).click();
await page.waitForTimeout(500);
await shoot(page, '08-library');
await page.locator('.list-item').first().click();
await page.waitForSelector('.sheet', { timeout: 10000 });
await page.waitForTimeout(400);
await shoot(page, '09-sku');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

await page.getByRole('button', { name: '扫码', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '开始实时扫码' }).click();
await page.waitForTimeout(2500);
await shoot(page, '11-scan-live');

const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
const desktopPage = await desktop.newPage();
await collect(desktopPage, 'desktop');
await desktopPage.goto(url, { waitUntil: 'networkidle' });
await desktopPage.waitForTimeout(400);
await shoot(desktopPage, '12-desktop-scan');
await desktopPage.getByRole('button', { name: '库存' }).click();
await desktopPage.waitForTimeout(400);
await shoot(desktopPage, '13-desktop-pantry');

await browser.close();

if (problems.length) {
  console.log('\nPROBLEMS:');
  problems.forEach((item) => console.log(' -', item));
  process.exitCode = 1;
} else {
  console.log('\nno console errors');
}
