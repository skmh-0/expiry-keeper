/**
 * 用真实背标照片跑一遍「填 Key → 传图 → 识别 → 回填确认表单」，
 * 验证的是与 APK 同一份前端代码，只差运行环境（浏览器 vs WebView）。
 *
 * 用法：
 *   $env:DEEPSEEK_API_KEY='sk-...'
 *   node scripts/shot-vision.mjs shots/label-1400.jpg
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const photo = process.argv[2] ?? 'shots/label-1400.jpg';
const key = (process.env.DEEPSEEK_API_KEY ?? '').trim();
const outDir = process.env.OUT ?? 'shots';

if (!key) {
  console.error('请先设置 DEEPSEEK_API_KEY');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();
const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.getByPlaceholder('sk-...').fill(key);
await page.getByPlaceholder('sk-...').blur();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '验证 API Key' }).click();
await page.waitForTimeout(6000);
const verifyText = await page.locator('.notice').first().innerText().catch(() => '(无)');
console.log(`验证 Key：${verifyText.replace(/\s+/g, ' ')}`);

await page.getByRole('button', { name: '扫码', exact: true }).click();
await page.waitForTimeout(300);
const inputs = page.locator('input[type=file]');
console.log(`file input 数量：${await inputs.count()}`);
await inputs.nth(1).setInputFiles(photo);

const started = Date.now();
await page.getByRole('button', { name: /识别这 \d+ 张/ }).click();
await page.waitForSelector('.sheet', { timeout: 150000 });
console.log(`识别耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
await page.waitForTimeout(600);

const icon = await page.evaluate(() => {
  const tile = document.querySelector('.thumb-row .brand-tile');
  const text = document.querySelector('.thumb-text .block-label')?.textContent?.trim() ?? '';
  return { tile: tile ? tile.textContent.trim() : null, text };
});
console.log(`商品图标：${icon.tile ?? '无'}（${icon.text}）`);

await page.locator('label.field', { hasText: '重量' }).locator('input').first().fill('300');
await page.locator('label.field', { hasText: '存放位置' }).locator('input').fill('厨房吊柜');
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/vision-01-review.png`, fullPage: false });

const summary = await page.evaluate(() => {
  const read = (label) => {
    const field = [...document.querySelectorAll('label.field')].find((node) =>
      node.querySelector('.field-label')?.textContent?.includes(label),
    );
    const input = field?.querySelector('input, textarea');
    return input ? input.value : '';
  };
  return {
    商品名称: read('商品名称'),
    品牌: read('品牌'),
    生产厂家: read('生产厂家'),
    许可证: read('食品生产许可证编号'),
    产品标准: read('产品标准代号'),
    保质期: read('保质期'),
    生产日期: read('生产日期'),
    到期日: read('到期日'),
    配料表: read('配料表原文').slice(0, 80),
    校验: [...document.querySelectorAll('.check')].map((node) => node.textContent.trim()),
  };
});
console.log(JSON.stringify(summary, null, 2));

await page.locator('.sheet-body').evaluate((node) => {
  node.scrollTop = node.scrollHeight;
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/vision-02-checks.png`, fullPage: false });

await page.getByRole('button', { name: '确认入库' }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${outDir}/vision-03-pantry.png`, fullPage: false });
const row = await page.locator('.list-item').first().innerText();
console.log(`列表行：${row.replace(/\s+/g, ' ')}`);

await browser.close();
if (problems.length) {
  console.log('\nPROBLEMS:');
  problems.forEach((item) => console.log(' -', item));
}
