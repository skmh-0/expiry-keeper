/**
 * 验证开封/用完默认只扣 1 件：
 * 300克 ×3 → 开封扣 1 件 → 库存剩 200克 ×2 + 新的一条 100克 ×1（已开封）
 * → 那条 100克 用完 → 归档进消耗页
 */
import { chromium } from 'playwright';
import { readSeededState, seedState } from './seed-state.mjs';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await seedState(page, {
      schema: 3,
      skus: [
        {
          gtin: '6901234567892',
          name: '测试冻干猫粮 100g',
          brand: '测试牌',
          category: 'dry',
          manufacturer: '测试宠物食品有限公司',
          ingredientsRaw: '鲜鸡胸肉',
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
          id: 'item-3pack',
          gtin: '6901234567892',
          expiryDate: '2027-10-31',
          quantity: 300,
          unit: '克',
          count: 3,
          location: '厨房',
          createdAt: Date.now(),
        },
      ],
      settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(400);
console.log('初始：', (await page.locator('.list-item').first().innerText()).replace(/\s+/g, ' '));

await page.locator('.list-item').first().click();
await page.waitForTimeout(400);
console.log('底部按钮：', (await page.locator('.sheet-foot button').allInnerTexts()).map((t) => t.trim()).join(' | '));

const totalGrams = async () => (await readSeededState(page))?.items?.[0]?.quantity;

// 改件数时总克数跟着走（单件 100 克：3 件 300 克 → 2 件 200 克）
const countField = page.locator('label.field', { hasText: /^(件数|数量)/ });
await countField.getByRole('button', { name: '减少' }).click();
await page.waitForTimeout(700);
console.log(
  '件数减 1 后：',
  (await countField.locator('.stepper-value').innerText()).replace(/\s+/g, ''),
  '|',
  await totalGrams(),
  '克',
);
await countField.getByRole('button', { name: '增加' }).click();
await page.waitForTimeout(700);
console.log(
  '件数加回后：',
  (await countField.locator('.stepper-value').innerText()).replace(/\s+/g, ''),
  '|',
  await totalGrams(),
  '克',
);

await page.getByRole('button', { name: '开封扣 1 件' }).click();
await page.waitForTimeout(700);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

for (const text of await page.locator('.list-item').allInnerTexts()) {
  console.log('开封后：', text.replace(/\s+/g, ' '));
}
await page.screenshot({ path: 'shots/split-01-opened.png', fullPage: false });

// 用完那条已开封的
const openedRow = page.locator('.list-item', { hasText: '已开封' }).first();
await openedRow.click();
await page.waitForTimeout(400);
console.log('已开封那条的按钮：', (await page.locator('.sheet-foot button').allInnerTexts()).map((t) => t.trim()).join(' | '));
await page.getByRole('button', { name: '已用完' }).click();
await page.waitForTimeout(700);
console.log('用完后的库存：');
for (const text of await page.locator('.list-item').allInnerTexts()) {
  console.log('  -', text.replace(/\s+/g, ' '));
}

await page.getByRole('button', { name: '消耗', exact: true }).click();
await page.waitForTimeout(500);
console.log('消耗页合计：', (await page.locator('.stat').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' | '));
for (const text of await page.locator('.consume-row').allInnerTexts()) {
  console.log('  -', text.replace(/\s+/g, ' '));
}
await page.screenshot({ path: 'shots/split-02-consume.png', fullPage: false });

await browser.close();
