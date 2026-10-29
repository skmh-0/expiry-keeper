/**
 * 搜索回归（输入法不触发事件也要能搜）：
 *  1 边打边筛（正常输入法）
 *  2 直接改值、不触发任何事件 → 点放大镜按钮要能筛出来
 *  3 直接改值 + 回车 → 要能筛出来
 *  4 档案库搜索同样三种方式都能用
 */
import { chromium } from 'playwright';
import { seedState } from './seed-state.mjs';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const page = await context.newPage();
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通过' : '失败'} · ${label}${detail ? ` · ${detail}` : ''}`);
};

const sku = (gtin, name, brand) => ({
  gtin,
  name,
  brand,
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
});

await page.goto(url, { waitUntil: 'networkidle' });
await seedState(page, {
  schema: 3,
  skus: [sku('6901234567892', '向茸冻干猫粮', '向茸'), sku('6901234567908', '麦富迪主食罐', '麦富迪')],
  items: [
    { id: 'item-a', gtin: '6901234567892', quantity: 300, unit: '克', location: '厨房', createdAt: Date.now() },
    { id: 'item-b', gtin: '6901234567908', quantity: 85, unit: '克', location: '阳台', createdAt: Date.now() },
  ],
  settings: { apiKey: '', remindEnabled: false, remindDays: 7 },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.getByRole('button', { name: '库存', exact: true }).click();
await page.waitForTimeout(500);
check('0 初始两条都在', (await page.locator('.list-item').count()) === 2);

const searchInput = page.getByPlaceholder('搜索商品、品牌或条码');
const setValueDirectly = (value) =>
  page.evaluate((text) => {
    const input = document.querySelector('.search-box input');
    if (input) input.value = text;
  }, value);

// 1 正常输入
await searchInput.fill('麦富迪');
await page.waitForTimeout(700);
check('1 边打边筛命中 1 条', (await page.locator('.list-item').count()) === 1, `${await page.locator('.list-item').count()} 条`);
await searchInput.fill('');
await page.waitForTimeout(700);

// 2 不触发事件，直接改值 + 点放大镜
await setValueDirectly('向茸');
await page.getByRole('button', { name: '搜索', exact: true }).click();
await page.waitForTimeout(500);
check('2 点放大镜能筛出来', (await page.locator('.list-item').count()) === 1, `${await page.locator('.list-item').count()} 条`);

// 3 不触发事件，直接改值 + 回车
await setValueDirectly('阳台');
await searchInput.press('Enter');
await page.waitForTimeout(500);
check('3 回车能按位置筛出来', (await page.locator('.list-item').count()) === 1, `${await page.locator('.list-item').count()} 条`);

// 4 档案库搜索
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '打开商品档案库' }).click();
await page.waitForTimeout(500);
check('4 档案库初始两条', (await page.locator('.list-item').count()) === 2);
await page.evaluate(() => {
  const input = document.querySelector('.search-box input');
  if (input) input.value = '麦富迪';
});
await page.getByRole('button', { name: '搜索', exact: true }).first().click();
await page.waitForTimeout(500);
check('4 档案库点放大镜能筛出来', (await page.locator('.list-item').count()) === 1, `${await page.locator('.list-item').count()} 条`);
await page.screenshot({ path: 'shots/search-01-library.png', fullPage: false });

console.log(failed ? `\n有 ${failed} 项没通过` : '\n全部通过');
await browser.close();
process.exit(failed ? 1 : 0);
