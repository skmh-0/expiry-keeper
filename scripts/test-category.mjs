/** 验证干湿粮分类与常见厂家快选。 */
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
      schema: 3,
      skus: [
        {
          gtin: '6901234567892',
          name: '测试冻干猫粮 300g',
          brand: '测试牌',
          category: 'dry',
          kind: 'staple',
          manufacturer: '乖宝宠物食品集团股份有限公司',
          ingredientsRaw: '鲜鸡胸肉',
          ingredients: [],
          additives: [],
          allergens: [],
          shelfLifeText: '18个月',
          source: 'api',
          version: 1,
          confidence: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          gtin: '6901234567908',
          name: '测试主食罐 85g',
          brand: '测试牌',
          category: 'wet',
          kind: 'snack',
          manufacturer: '上海福贝宠物用品股份有限公司',
          ingredientsRaw: '鸡肉',
          ingredients: [],
          additives: [],
          allergens: [],
          shelfLifeText: '24个月',
          source: 'manual',
          version: 1,
          confidence: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      items: [
        { id: 'item-c1', gtin: '6901234567892', quantity: 300, unit: '克', location: '厨房', createdAt: Date.now() },
        { id: 'item-c2', gtin: '6901234567908', quantity: 85, unit: '克', location: '厨房', createdAt: Date.now() },
      ],
      settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
    }),
  );
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(400);
console.log('干湿库存卡片：', (await page.locator('.stat').first().innerText()).replace(/\s+/g, ' '));
console.log('列表里的分类标记：', (await page.locator('.chip').allInnerTexts()).map((t) => t.trim()).join(' / '));
await page.getByPlaceholder('搜索商品、品牌或条码').fill('干粮');
await page.waitForTimeout(400);
console.log('搜索「干粮」命中：', await page.locator('.list-item').count());
await page.getByPlaceholder('搜索商品、品牌或条码').fill('');
await page.waitForTimeout(300);

// 库存同时保留干湿分类与「全部 / 主食 / 零食」用途筛选
const foodGroupFilter = page.locator('.screen > .segmented').filter({ hasText: '全部干湿' });
await foodGroupFilter.getByRole('tab', { name: '湿粮', exact: true }).click();
await page.waitForTimeout(300);
console.log('筛「湿粮」条数：', await page.locator('.list-item').count());
await foodGroupFilter.getByRole('tab', { name: '干粮', exact: true }).click();
await page.waitForTimeout(300);
console.log('筛「干粮」条数：', await page.locator('.list-item').count());
await foodGroupFilter.getByRole('tab', { name: '全部干湿', exact: true }).click();
await page.waitForTimeout(300);
const kindFilter = page.locator('.screen > .segmented').filter({ hasText: '主食' }).filter({ hasText: '零食' });
console.log('用途筛选行：', (await kindFilter.innerText()).replace(/\s+/g, ' '));
await kindFilter.getByRole('tab', { name: '零食', exact: true }).click();
await page.waitForTimeout(400);
console.log('筛「零食」条数：', await page.locator('.list-item').count());
await kindFilter.getByRole('tab', { name: '主食', exact: true }).click();
await page.waitForTimeout(300);
console.log('筛「主食」条数：', await page.locator('.list-item').count());
await kindFilter.getByRole('tab', { name: '全部', exact: true }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/cat-01-pantry.png', fullPage: false });

// 确认页：类型分段 + 厂家快选
await page.getByRole('button', { name: '扫码', exact: true }).click();
await page.waitForTimeout(300);
await page.getByPlaceholder('13 位商品条码').fill('6901234567892');
await page.getByRole('button', { name: '查询' }).click();
await page.waitForSelector('.sheet', { timeout: 10000 });
await page.waitForTimeout(500);
const selected = await page.locator('.sheet .segmented button.on').allInnerTexts();
console.log('类型分段选中：', selected.map((t) => t.trim()).join(' / '));
// 类型 / 用途 两级分段的截图
await page.locator('.sheet .segmented').nth(1).scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/cat-05-kind.png', fullPage: false });
console.log('带出的厂家：', await page.locator('label.field', { hasText: /^生产厂家/ }).locator('input').inputValue());

await page.getByRole('button', { name: /从常见厂家里选/ }).click();
await page.waitForTimeout(400);
console.log('厂家名单条数：', await page.locator('.maker-list li').count());
await page.screenshot({ path: 'shots/cat-02-makers.png', fullPage: false });
await page.locator('.maker-list button').first().click();
await page.waitForTimeout(400);
console.log('点选后厂家：', await page.locator('label.field', { hasText: /^生产厂家/ }).locator('input').inputValue());

// 数量调整（在克数下方）+ 入库后列表显示
await page.locator('label.field', { hasText: /重量/ }).locator('input').first().fill('300');
const increase = page.locator('label.field', { hasText: /^(件数|数量)/ }).getByRole('button', { name: '增加' });
await increase.click();
await increase.click();
console.log('数量步进器：', (await page.locator('label.field', { hasText: /^(件数|数量)/ }).locator('.stepper-value').innerText()).replace(/\s+/g, ''));
await page.getByRole('button', { name: '确认入库' }).click();
await page.waitForTimeout(900);
for (const text of await page.locator('.list-item').allInnerTexts()) {
  console.log('入库后列表行：', text.replace(/\s+/g, ' '));
}
await page.screenshot({ path: 'shots/cat-03-count.png', fullPage: false });

await browser.close();
