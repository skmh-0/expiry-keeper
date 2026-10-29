/** 2.7：消耗页分别统计干粮、湿粮与合计。 */
import { chromium } from 'playwright';
import { seedState } from './seed-state.mjs';

const url = process.env.URL ?? 'http://127.0.0.1:5273';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })).newPage();
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通过' : '失败'} · ${label}${detail ? ` · ${detail}` : ''}`);
};
const now = Date.now();
const sku = (gtin, name, category) => ({
  gtin,
  name,
  brand: '测试牌',
  manufacturer: '测试工厂',
  ingredientsRaw: '鸡肉',
  ingredients: [],
  additives: [],
  allergens: [],
  category,
  kind: 'staple',
  source: 'manual',
  version: 1,
  confidence: {},
  createdAt: now,
  updatedAt: now,
});
const item = (id, gtin, quantity, openedAt, finishedAt) => ({
  id,
  gtin,
  quantity,
  unit: '克',
  count: 1,
  location: '',
  openedAt,
  finishedAt,
  createdAt: now,
});

await page.goto(url, { waitUntil: 'networkidle' });
await seedState(page, {
  schema: 6,
  skus: [sku('6901234567892', '干粮', 'dry'), sku('6901234567908', '湿粮罐', 'wet')],
  items: [
    item('dry-item', '6901234567892', 100, '2026-09-01', '2026-09-11'),
    item('wet-item', '6901234567908', 60, '2026-09-02', '2026-09-12'),
  ],
  pets: [],
  feedings: [],
  vaccinations: [],
  dewormings: [],
  activePetId: '',
  settings: {
    apiKey: '',
    remindEnabled: false,
    remindDays: 7,
    reminders: {
      expiryEnabled: false,
      vaccineEnabled: false,
      dewormEnabled: false,
      enabledAt: {},
    },
  },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: '消耗', exact: true }).click();
await page.getByRole('tab', { name: '全部', exact: true }).click();
await page.waitForTimeout(500);
const card = page.locator('.screen > .stat-grid.stat-grid-3').first();
const text = (await card.innerText()).replace(/\s+/g, ' ');
check('干粮消耗单独统计 100 克', text.includes('100 干粮(克)'), text);
check('湿粮消耗单独统计 60 克', text.includes('60 湿粮(克)'), text);
check('干湿粮合计 160 克', text.includes('160 合计(克)'), text);
await page.getByRole('tab', { name: '只看干粮', exact: true }).click();
await page.waitForTimeout(350);
check('只看干粮时明细仅剩干粮', (await page.locator('.consume-row').count()) === 1 && (await page.locator('.consume-row').innerText()).includes('干粮'));
await page.getByRole('tab', { name: '只看湿粮', exact: true }).click();
await page.waitForTimeout(350);
check('只看湿粮时明细仅剩湿粮', (await page.locator('.consume-row').count()) === 1 && (await page.locator('.consume-row').innerText()).includes('湿粮罐'));

await browser.close();
if (failed) process.exit(1);
console.log('全部通过');

