/**
 * 验证两条新规则：
 *  1. 到期日 = 生产日期 + 保质期 − 1 天（2025-05-01 + 18个月 → 2026-10-31）
 *  2. 临期阈值 = 保质期的一半；注意阈值 = 3 个月（90 天），按每个商品自己的保质期算
 */
import { chromium } from 'playwright';
import { seedState } from './seed-state.mjs';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();

await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  const sku = (gtin, shelf) => ({
    gtin,
    name: `测试${gtin.slice(-1)}`,
    brand: '测试牌',
    manufacturer: '测试厂',
    ingredientsRaw: '水',
    ingredients: [],
    additives: [],
    allergens: [],
    shelfLifeText: shelf,
    source: 'manual',
    version: 1,
    confidence: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const item = (id, gtin, expiry) => ({
    id,
    gtin,
    expiryDate: expiry,
    quantity: 100,
    unit: '克',
    location: '',
    createdAt: Date.now(),
  });
  localStorage.setItem(
    'expiry-keeper:v1',
    JSON.stringify({
      schema: 2,
      // 18 个月：一半 = 270 天；7 天：一半 = 4 天
      skus: [sku('6900000000011', '18个月'), sku('6900000000028', '7天')],
      items: [
        item('i-1', '6900000000011', '2026-10-31'), // 剩 35 天 ≤ 90 → 临期
        item('i-2', '6900000000028', '2026-10-01'), // 剩 5 天 ≤ 90 → 临期
        item('i-3', '6900000000028', '2026-09-29'), // 剩 3 天 ≤ 90 → 临期
        item('i-4', '6900000000011', '2026-09-01'), // 已过期
        item('i-5', '6900000000011', '2027-04-15'), // 剩 201 天：90 < 201 ≤ 270 → 保质期过半
        item('i-6', '6900000000011', '2027-08-01'), // 剩 309 天 > 270 → 充足
      ],
      settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
    }),
  );
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(400);
console.log('统计卡：', (await page.locator('.stat').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | '));
for (const text of await page.locator('.list-item').allInnerTexts()) {
  console.log('  -', text.replace(/\s+/g, ' '));
}

// 到期日推算：生产 2025-05-01 + 18 个月 应得 2026-10-31
await page.getByRole('button', { name: '扫码', exact: true }).click();
await page.waitForTimeout(300);
await page.getByPlaceholder('13 位商品条码').fill('6909999999999');
await page.getByRole('button', { name: '查询' }).click();
await page.waitForSelector('.sheet', { timeout: 10000 });
await page.locator('label.field', { hasText: /^保质期/ }).locator('input').fill('18个月');
await page.locator('label.field', { hasText: /^生产日期/ }).locator('input').fill('2025-05-01');
await page.waitForTimeout(500);
const expiry = await page.locator('label.field', { hasText: /^到期日/ }).locator('input').inputValue();
console.log('生产 2025-05-01 + 18个月 → 到期日：', expiry);
await page.screenshot({ path: 'shots/rules-01-expiry.png', fullPage: false });

// 旧数据迁移：schema 2 里按旧规则算出来的到期日应自动往前挪一天
await seedState(page, {
      schema: 2,
      skus: [
        {
          gtin: '6900000000011',
          name: '老数据',
          brand: '测试牌',
          manufacturer: '测试厂',
          ingredientsRaw: '水',
          ingredients: [],
          additives: [],
          allergens: [],
          shelfLifeText: '18个月',
          source: 'manual',
          version: 1,
          confidence: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      items: [
        {
          id: 'old-1',
          gtin: '6900000000011',
          productionDate: '2026-05-01',
          expiryDate: '2027-11-01',
          quantity: 100,
          unit: '克',
          location: '',
          createdAt: Date.now(),
        },
      ],
      settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const migrated = await page.evaluate(
  () => JSON.parse(localStorage.getItem('expiry-keeper:v1')).items[0].expiryDate,
);
console.log('旧数据 2027-11-01 迁移为：', migrated);

await browser.close();
