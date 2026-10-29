/**
 * 商品档案库回归：
 *  1. 档案里不再维护条码/保质期字段（条码只读、作为索引）
 *  2. 再次录入同一商品时会调出档案并提示二次确认
 *  3. 删除档案后库存记录保留
 */
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();

await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  localStorage.setItem(
    'expiry-keeper:v1',
    JSON.stringify({
      schema: 2,
      skus: [
        {
          gtin: '6901234567892',
          name: '测试商品 500g',
          brand: '测试牌',
          manufacturer: '测试食品有限公司',
          ingredientsRaw: '水、小麦粉',
          ingredients: [],
          additives: [],
          allergens: [],
          shelfLifeText: '12个月',
          source: 'manual',
          version: 1,
          confidence: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      items: [
        { id: 'item-x', gtin: '6901234567892', quantity: 500, unit: '克', location: '厨房吊柜', createdAt: Date.now() },
      ],
      settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
    }),
  );
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// 1. 档案编辑器
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.getByRole('button', { name: '打开商品档案库' }).click();
await page.waitForTimeout(400);
await page.locator('.list-item').first().click();
await page.waitForTimeout(400);
const labels = await page.locator('.sheet .field-label').allInnerTexts();
console.log('档案编辑器字段：', labels.map((t) => t.trim()).join(' / '));
console.log('是否还有保质期输入：', labels.some((t) => t.includes('保质期')) ? '有' : '没有');
console.log('条码是否只读展示：', (await page.locator('.kv-key').allInnerTexts()).join(' / '));
await page.screenshot({ path: 'shots/lib-01-editor.png', fullPage: false });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// 2. 再次录入同一商品 → 二次确认提示
await page.getByRole('button', { name: '扫码', exact: true }).click();
await page.waitForTimeout(300);
await page.getByPlaceholder('13 位商品条码').fill('6901234567892');
await page.getByRole('button', { name: '查询' }).click();
await page.waitForSelector('.sheet', { timeout: 10000 });
await page.waitForTimeout(500);
const notices = await page.locator('.sheet .notice').allInnerTexts();
console.log('确认页提示：', notices.map((t) => t.replace(/\s+/g, ' ')).join(' | '));
console.log('带出的厂家：', await page.locator('label.field', { hasText: '生产厂家' }).locator('input').inputValue());
await page.screenshot({ path: 'shots/lib-02-reentry.png', fullPage: false });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// 3. 删除档案，库存记录应保留
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.getByRole('button', { name: '打开商品档案库' }).click();
await page.waitForTimeout(400);
await page.locator('.list-item').first().click();
await page.waitForTimeout(400);
page.on('dialog', (dialog) => {
  console.log('确认弹窗：', dialog.message().replace(/\s+/g, ' '));
  void dialog.accept();
});
await page.getByRole('button', { name: '删除这个商品档案' }).click();
await page.waitForTimeout(800);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(400);
console.log('库存行：', (await page.locator('.list-item').first().innerText()).replace(/\s+/g, ' '));

await browser.close();
