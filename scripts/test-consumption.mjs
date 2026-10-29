/**
 * 按用户给的例子验证消耗摊算：
 * 9.5 开封、9.15 用完、共 100 克；筛 9.10~9.15 应该约 50 克。
 */
import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();

await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  const sku = {
    gtin: '6978017950271',
    name: '私厨系列主食冻干-鸡肉芝士草莓味',
    brand: '向茸',
    manufacturer: '青岛纽瑟奇生物科技有限公司',
    ingredientsRaw: '鲜鸡胸肉、奶酪',
    ingredients: [],
    additives: [],
    allergens: [],
    shelfLifeText: '18个月',
    source: 'api',
    version: 1,
    confidence: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const mk = (id, openedAt, finishedAt, quantity, unit = '克') => ({
    id,
    gtin: '6978017950271',
    productionDate: '2026-05-01',
    expiryDate: '2027-11-01',
    quantity,
    unit,
    location: '厨房吊柜',
    openedAt,
    finishedAt,
    createdAt: Date.now(),
  });
  localStorage.setItem(
    'expiry-keeper:v1',
    JSON.stringify({
      schema: 2,
      skus: [sku],
      items: [
        mk('item-a', '2026-09-05', '2026-09-15', 100),
        mk('item-b', '2026-09-20', undefined, 300),
        // 当天开封当天用完：整份应算进那一天
        mk('item-c', '2026-09-12', '2026-09-12', 60),
        // 没开封的在库商品：不进消耗统计，但库存页要显示它
        mk('item-d', undefined, undefined, 500),
        // 按袋记录的旧数据换算不出克数，不应被当成 1 克算进消耗
        mk('item-e', '2026-09-10', '2026-09-12', 1, '袋'),
      ],
      settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
    }),
  );
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// 库存页：已开封标记
await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(500);
console.log('库存统计：', (await page.locator('.stat').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | '));
console.log('已开封标记：', (await page.locator('.chip-info').allInnerTexts()).join(' / ') || '（无）');
await page.screenshot({ path: 'shots/opened-01-pantry.png', fullPage: false });

// 点「已开封」统计卡应该筛出已开封商品
await page.locator('button.stat').click();
await page.waitForTimeout(400);
console.log('筛选后条目数：', await page.locator('.list-item').count());
await page.screenshot({ path: 'shots/opened-02-filter.png', fullPage: false });

await page.getByRole('button', { name: '消耗', exact: true }).click();
await page.waitForTimeout(400);
await page.locator('label.field', { hasText: '开始日期' }).locator('input').fill('2026-09-10');
await page.locator('label.field', { hasText: '结束日期' }).locator('input').fill('2026-09-15');
await page.waitForTimeout(500);

console.log('统计卡：', (await page.locator('.stat').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | '));
console.log('明细行：');
for (const text of await page.locator('.consume-row').allInnerTexts()) {
  console.log('  -', text.replace(/\s+/g, ' '));
}
await page.screenshot({ path: 'shots/consume-01-window.png', fullPage: false });

// 再看全部区间：应把在用中的估算也算进来
await page.getByRole('tab', { name: '全部', exact: true }).click();
await page.waitForTimeout(500);
console.log('全部统计：', (await page.locator('.stat').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | '));
await page.screenshot({ path: 'shots/consume-02-all.png', fullPage: true });

await browser.close();
